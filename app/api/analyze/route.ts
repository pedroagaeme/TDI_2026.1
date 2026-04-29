import { writeFile } from 'node:fs/promises';
import { NextResponse } from 'next/server';
import { createAnalysisStorageRecord } from '@/lib/analysis-storage';
import { analyzeVideoWithGoogle } from '@/lib/google-video-intelligence';
import { generateQuizMomentsFromOpenRouter } from '@/lib/openrouter';
import type { AnalyzeApiResponse } from '@/lib/types';

export const runtime = 'nodejs';

function toMb(size: number) {
  return Math.round((size / 1024 / 1024) * 10) / 10;
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const uploaded = formData.get('video');
  const accountId = formData.get('accountId');

  if (typeof accountId !== 'string' || !accountId.trim()) {
    return NextResponse.json({ error: 'Account ID is required.' }, { status: 400 });
  }

  if (!(uploaded instanceof File)) {
    return NextResponse.json({ error: 'Please upload a video file.' }, { status: 400 });
  }

  if (!uploaded.type.startsWith('video/')) {
    return NextResponse.json({ error: 'The selected file must be a video.' }, { status: 400 });
  }

  if (uploaded.size > 80 * 1024 * 1024) {
    return NextResponse.json(
      { error: `Video is too large (${toMb(uploaded.size)} MB). Keep it below 80 MB for this version.` },
      { status: 413 }
    );
  }

  const storageRecord = await createAnalysisStorageRecord(uploaded.name, accountId);

  try {
    const buffer = Buffer.from(await uploaded.arrayBuffer());
    await writeFile(storageRecord.videoPath, buffer);

    const analysis = await analyzeVideoWithGoogle(storageRecord.videoPath, uploaded.name);
    const quizGeneration = await generateQuizMomentsFromOpenRouter(analysis, uploaded.name);

    await writeFile(
      storageRecord.googleAnnotationPath,
      JSON.stringify(
        {
          analysisId: storageRecord.analysisId,
          accountId: storageRecord.accountId,
          fileName: uploaded.name,
          videoPath: storageRecord.videoPath,
          googleAnnotation: analysis.rawGoogleResponse,
          normalizedAnalysis: {
            transcript: analysis.transcript,
            visualSummary: analysis.visualSummary,
            cues: analysis.cues,
            durationSeconds: analysis.durationSeconds,
            sourceLabel: analysis.sourceLabel
          },
          savedAt: new Date().toISOString()
        },
        null,
        2
      )
    );

    await writeFile(
      storageRecord.openRouterResponsePath,
      JSON.stringify(
        {
          analysisId: storageRecord.analysisId,
          accountId: storageRecord.accountId,
          fileName: uploaded.name,
          model: quizGeneration.model,
          rawContent: quizGeneration.rawContent,
          rawResponse: quizGeneration.rawResponse,
          quizMoments: quizGeneration.quizMoments,
          savedAt: new Date().toISOString()
        },
        null,
        2
      )
    );

    await writeFile(
      storageRecord.manifestPath,
      JSON.stringify(
        {
          analysisId: storageRecord.analysisId,
          accountId: storageRecord.accountId,
          fileName: uploaded.name,
          videoPath: storageRecord.videoPath,
          googleAnnotationPath: storageRecord.googleAnnotationPath,
          openRouterResponsePath: storageRecord.openRouterResponsePath,
          analysisSummary: analysis.visualSummary,
          sourceLabel: analysis.sourceLabel,
          quizMomentCount: quizGeneration.quizMoments.length,
          savedAt: new Date().toISOString()
        },
        null,
        2
      )
    );

    const response: AnalyzeApiResponse = {
      analysisId: storageRecord.analysisId,
      quizMoments: quizGeneration.quizMoments,
      analysisSummary: analysis.visualSummary,
      sourceLabel: analysis.sourceLabel
    };

    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      {
        error: (error as Error).message || 'Failed to analyze the uploaded video.'
      },
      { status: 500 }
    );
  }
}
