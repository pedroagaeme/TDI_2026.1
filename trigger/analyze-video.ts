import { task } from '@trigger.dev/sdk';
import { analyzeVideoBytesWithGoogle } from '@/lib/google-video-intelligence';
import { generateQuizMomentsFromOpenRouter } from '@/lib/openrouter';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';
import type { AnalyzeApiResponse } from '@/lib/types';

type AnalyzeVideoPayload = {
  analysisId: string;
  accountId: string;
  fileName: string;
  videoObjectPath: string;
};

function uploadJson(client: ReturnType<typeof createSupabaseAdminClient>, bucket: string, path: string, value: unknown) {
  return client.storage.from(bucket).upload(path, Buffer.from(JSON.stringify(value, null, 2), 'utf8'), {
    contentType: 'application/json',
    upsert: true
  });
}

export const analyzeVideoTask = task({
  id: 'analyze-video',
  retry: {
    maxAttempts: 3
  },
  run: async (payload: AnalyzeVideoPayload): Promise<AnalyzeApiResponse> => {
    const supabase = createSupabaseAdminClient();

    const { data: videoData, error: downloadError } = await supabase.storage
      .from('videos')
      .download(payload.videoObjectPath);

    if (downloadError || !videoData) {
      throw new Error(downloadError?.message || 'Failed to download the uploaded video from Supabase Storage.');
    }

    const videoBuffer = Buffer.from(await videoData.arrayBuffer());
    const analysis = await analyzeVideoBytesWithGoogle(videoBuffer, payload.fileName);
    const quizGeneration = await generateQuizMomentsFromOpenRouter(analysis, payload.fileName);

    const storedAt = new Date().toISOString();
    const annotationPath = `${payload.accountId}/${payload.analysisId}/google-annotations.json`;
    const questionsPath = `${payload.accountId}/${payload.analysisId}/questions.json`;

    const annotationPayload = {
      analysisId: payload.analysisId,
      accountId: payload.accountId,
      fileName: payload.fileName,
      videoObjectPath: payload.videoObjectPath,
      googleAnnotation: analysis.rawGoogleResponse,
      normalizedAnalysis: {
        transcript: analysis.transcript,
        visualSummary: analysis.visualSummary,
        cues: analysis.cues,
        durationSeconds: analysis.durationSeconds,
        sourceLabel: analysis.sourceLabel
      },
      savedAt: storedAt
    };

    const questionsPayload = {
      analysisId: payload.analysisId,
      accountId: payload.accountId,
      fileName: payload.fileName,
      model: quizGeneration.model,
      rawContent: quizGeneration.rawContent,
      rawResponse: quizGeneration.rawResponse,
      quizMoments: quizGeneration.quizMoments,
      savedAt: storedAt
    };

    const [annotationUpload, questionsUpload] = await Promise.all([
      uploadJson(supabase, 'annotations', annotationPath, annotationPayload),
      uploadJson(supabase, 'questions', questionsPath, questionsPayload)
    ]);

    if (annotationUpload.error) {
      throw new Error(annotationUpload.error.message);
    }

    if (questionsUpload.error) {
      throw new Error(questionsUpload.error.message);
    }

    return {
      analysisId: payload.analysisId,
      quizMoments: quizGeneration.quizMoments,
      analysisSummary: analysis.visualSummary,
      sourceLabel: analysis.sourceLabel
    };
  }
});
