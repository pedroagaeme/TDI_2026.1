import { NextResponse } from 'next/server';
import { listManifestsForAccount, sanitizeAccountId } from '@/lib/analysis-storage';
import type { ListStoredAnalysesApiResponse, StoredAnalysisItem } from '@/lib/types';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const accountId = sanitizeAccountId(searchParams.get('accountId') || '');

  if (!accountId) {
    return NextResponse.json({ error: 'accountId query parameter is required.' }, { status: 400 });
  }

  const manifests = await listManifestsForAccount(accountId);

  const items: StoredAnalysisItem[] = manifests.map((manifest) => ({
    analysisId: manifest.analysisId,
    fileName: manifest.fileName,
    analysisSummary: manifest.analysisSummary,
    sourceLabel: manifest.sourceLabel,
    quizMomentCount: manifest.quizMomentCount,
    savedAt: manifest.savedAt,
    videoUrl: `/api/analyses/${manifest.analysisId}/video?accountId=${encodeURIComponent(accountId)}`,
    savedQuizUrl: `/api/analyses/${manifest.analysisId}/quiz?accountId=${encodeURIComponent(accountId)}`,
    googleAnnotationUrl: `/api/analyses/${manifest.analysisId}/artifact?accountId=${encodeURIComponent(accountId)}&type=google`,
    openRouterResponseUrl: `/api/analyses/${manifest.analysisId}/artifact?accountId=${encodeURIComponent(accountId)}&type=openrouter`
  }));

  const response: ListStoredAnalysesApiResponse = {
    accountId,
    items
  };

  return NextResponse.json(response);
}