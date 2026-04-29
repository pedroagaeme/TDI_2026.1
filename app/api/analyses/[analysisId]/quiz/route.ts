import { readFile } from 'node:fs/promises';
import { NextResponse } from 'next/server';
import { readManifest, sanitizeAccountId } from '@/lib/analysis-storage';
import type { AnalyzeApiResponse } from '@/lib/types';

export const runtime = 'nodejs';

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