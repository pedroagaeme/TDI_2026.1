import { readFile } from 'node:fs/promises';
import { NextResponse } from 'next/server';
import { readManifest, sanitizeAccountId } from '@/lib/analysis-storage';
import type { AnalyzeApiResponse } from '@/lib/types';
import { createClient } from '@supabase/supabase-js';
import { generateQuizMomentsFromOpenRouter } from '@/lib/openrouter';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';
import type { NormalizedVideoAnalysis, QuizMoment } from '@/lib/types';

export const runtime = 'nodejs';

const ANALYSIS_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type StoredQuestionsPayload = {
  fileName?: string;
  quizMoments?: QuizMoment[];
  savedAt?: string;
  analysisSummary?: string;
  rawContent?: string;
  rawResponse?: unknown;
  model?: string;
  recalibratedAt?: string;
};

type StoredAnnotationsPayload = {
  fileName?: string;
  savedAt?: string;
  googleAnnotation?: unknown;
  normalizedAnalysis?: NormalizedVideoAnalysis;
};

export async function GET(request: Request, context: { params: { analysisId: string } }) {
  const { searchParams } = new URL(request.url);
  const accountId = sanitizeAccountId(searchParams.get('accountId') || '');

  if (!accountId) {
    return NextResponse.json({ error: 'accountId query parameter is required.' }, { status: 400 });
  }

  try {
    const manifest = await readManifest(accountId, context.params.analysisId);
    const openRouterText = await readFile(manifest.openRouterResponsePath, 'utf8');
    const openRouterPayload = JSON.parse(openRouterText) as { quizMoments?: AnalyzeApiResponse['quizMoments'] };

    if (!openRouterPayload.quizMoments?.length) {
      return NextResponse.json({ error: 'Saved quiz moments were not found for this analysis.' }, { status: 404 });
    }

    const response: AnalyzeApiResponse = {
      analysisId: manifest.analysisId,
      quizMoments: openRouterPayload.quizMoments,
      analysisSummary: manifest.analysisSummary,
      sourceLabel: manifest.sourceLabel
    };

    return NextResponse.json(response, {
      headers: {
        'Cache-Control': 'no-store'
      }
    });
  } catch {
    return NextResponse.json({ error: 'Saved analysis was not found for this account.' }, { status: 404 });
  }
}

function getBearerToken(request: Request) {
  const raw = request.headers.get('authorization') || request.headers.get('Authorization');
  const token = raw?.replace(/^Bearer\s+/i, '')?.trim();
  return token || null;
}

async function downloadJson<T>(admin: ReturnType<typeof createSupabaseAdminClient>, bucket: 'questions' | 'annotations', path: string) {
  const { data, error } = await admin.storage.from(bucket).download(path);

  if (error || !data) {
    throw new Error(error?.message || `Failed to download ${bucket} payload.`);
  }

  const text = await data.text();
  return JSON.parse(text) as T;
}

async function uploadJson(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  bucket: 'questions' | 'annotations',
  path: string,
  value: unknown
) {
  const { error } = await admin.storage.from(bucket).upload(path, Buffer.from(JSON.stringify(value, null, 2), 'utf8'), {
    contentType: 'application/json',
    upsert: true
  });

  if (error) {
    throw new Error(error.message);
  }
}

export async function POST(request: Request, context: { params: { analysisId: string } }) {
  const analysisId = context.params.analysisId;

  if (!analysisId || !ANALYSIS_ID_RE.test(analysisId)) {
    return NextResponse.json({ error: 'Invalid analysis id.' }, { status: 400 });
  }

  const token = getBearerToken(request);
  if (!token) {
    return NextResponse.json({ error: 'Authorization: Bearer <access_token> is required.' }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

  if (!supabaseUrl || !anonKey) {
    return NextResponse.json({ error: 'Server is missing Supabase URL or anon key.' }, { status: 500 });
  }

  const authClient = createClient(supabaseUrl, anonKey);
  const { data: userData, error: authError } = await authClient.auth.getUser(token);

  if (authError || !userData.user?.id) {
    return NextResponse.json({ error: 'Invalid or expired session.' }, { status: 401 });
  }

  const userId = userData.user.id;
  const questionsPath = `${userId}/${analysisId}/questions.json`;
  const annotationsPath = `${userId}/${analysisId}/google-annotations.json`;

  try {
    const admin = createSupabaseAdminClient();
    const [questionsPayload, annotationsPayload] = await Promise.all([
      downloadJson<StoredQuestionsPayload>(admin, 'questions', questionsPath),
      downloadJson<StoredAnnotationsPayload>(admin, 'annotations', annotationsPath)
    ]);

    const analysis = annotationsPayload.normalizedAnalysis;
    if (!analysis?.transcript || !analysis.visualSummary || !Array.isArray(analysis.cues)) {
      return NextResponse.json({ error: 'Saved analysis data is incomplete and cannot be recalibrated.' }, { status: 400 });
    }

    const fileName = questionsPayload.fileName || annotationsPayload.fileName || analysisId;
    const recalibration = await generateQuizMomentsFromOpenRouter(
      analysis,
      fileName,
      annotationsPayload.googleAnnotation,
      {
        recalibrate: true,
        priorMoments: questionsPayload.quizMoments
      }
    );

    if (!recalibration.quizMoments.length) {
      return NextResponse.json({ error: 'OpenRouter did not return any quiz moments during recalibration.' }, { status: 502 });
    }

    const savedAt = new Date().toISOString();
    const updatedQuestionsPayload: StoredQuestionsPayload = {
      ...questionsPayload,
      fileName,
      quizMoments: recalibration.quizMoments,
      model: recalibration.model,
      rawContent: recalibration.rawContent,
      rawResponse: recalibration.rawResponse,
      savedAt,
      recalibratedAt: savedAt
    };

    await uploadJson(admin, 'questions', questionsPath, updatedQuestionsPayload);

    const response: AnalyzeApiResponse = {
      analysisId,
      quizMoments: recalibration.quizMoments,
      analysisSummary: analysis.visualSummary,
      sourceLabel: analysis.sourceLabel
    };

    return NextResponse.json(response, {
      headers: {
        'Cache-Control': 'no-store'
      }
    });
  } catch (error) {
    const message = (error as Error).message || 'Failed to recalibrate quiz timestamps.';
    console.error('[POST /api/analyses/[analysisId]/quiz]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}