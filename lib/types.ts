import { z } from 'zod';

export const quizMomentSchema = z.object({
  timestamp: z.number().nonnegative(),
  correct_option_text: z.string().min(1),
  wrong_option_text: z.string().min(1)
});

export const quizMomentsSchema = z.array(quizMomentSchema).min(1);

export type QuizMoment = z.infer<typeof quizMomentSchema>;

export interface AnalysisCue {
  timestamp: number;
  source: 'speech' | 'text' | 'label' | 'scene' | 'fallback';
  description: string;
}

export interface NormalizedVideoAnalysis {
  transcript: string;
  visualSummary: string;
  cues: AnalysisCue[];
  durationSeconds?: number;
  sourceLabel: 'google' | 'mock';
}

export interface AnalyzeApiResponse {
  analysisId: string;
  quizMoments: QuizMoment[];
  analysisSummary: string;
  sourceLabel: 'google' | 'mock';
}

export interface StoredAnalysisManifest {
  analysisId: string;
  accountId: string;
  fileName: string;
  videoPath: string;
  googleAnnotationPath: string;
  openRouterResponsePath: string;
  analysisSummary: string;
  sourceLabel: 'google' | 'mock';
  quizMomentCount: number;
  savedAt: string;
}

export interface StoredAnalysisItem {
  analysisId: string;
  fileName: string;
  analysisSummary: string;
  sourceLabel: 'google' | 'mock';
  quizMomentCount: number;
  savedAt: string;
  videoUrl: string;
  savedQuizUrl: string;
  googleAnnotationUrl: string;
  openRouterResponseUrl: string;
}

export interface ListStoredAnalysesApiResponse {
  accountId: string;
  items: StoredAnalysisItem[];
}

export interface QuizAnswer {
  timestamp: number;
  selected: string;
  correct: string;
  isCorrect: boolean;
}
