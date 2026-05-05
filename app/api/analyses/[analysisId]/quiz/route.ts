import { readFile } from 'node:fs/promises';
import { NextResponse } from 'next/server';
import { readManifest, sanitizeAccountId } from '@/lib/analysis-storage';
import type { AnalyzeApiResponse } from '@/lib/types';

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
  // Recalibration endpoint removed per user request. Only GET (read) is supported for saved quiz payloads.
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