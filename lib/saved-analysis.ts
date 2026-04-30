import { supabase } from '@/lib/supabase-client';
import type { QuizMoment } from '@/lib/types';

export type SavedAnalysisEntry = {
  analysisId: string;
  fileName: string;
  analysisSummary: string;
  quizMomentCount: number;
  savedAt: string;
  videoPath: string;
  questionsPath: string;
  annotationsPath: string;
};

type QuestionsPayload = {
  fileName?: string;
  quizMoments?: QuizMoment[];
  savedAt?: string;
  analysisSummary?: string;
};

type AnnotationsPayload = {
  savedAt?: string;
  normalizedAnalysis?: {
    transcript?: string;
    visualSummary?: string;
    sourceLabel?: 'google' | 'mock';
  };
};

export type LoadedPlayback = {
  videoUrl: string;
  quizMoments: QuizMoment[];
  analysisSummary: string;
  sourceLabel: 'google' | 'mock';
};

export function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function safeParseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

async function downloadJson<T>(bucket: 'videos' | 'annotations' | 'questions', path: string) {
  const { data, error: downloadError } = await supabase.storage.from(bucket).download(path);
  if (downloadError || !data) {
    return null;
  }

  const text = await data.text();
  return safeParseJson<T>(text);
}

export async function downloadVideoObjectUrl(path: string) {
  const { data, error: downloadError } = await supabase.storage.from('videos').download(path);

  if (downloadError || !data) {
    throw new Error(downloadError?.message || 'Failed to download video from Supabase Storage.');
  }

  return URL.createObjectURL(data);
}

async function entryFromFolder(userId: string, analysisIdCandidate: string): Promise<SavedAnalysisEntry | null> {
  const analysisPrefix = `${userId}/${analysisIdCandidate}`;

  const { data: files, error: filesError } = await supabase.storage.from('videos').list(analysisPrefix, {
    limit: 100,
    sortBy: { column: 'name', order: 'asc' }
  });

  if (filesError) {
    throw new Error(filesError.message);
  }

  const videoFile = (files ?? []).find((entry) => entry.name.startsWith('video-') && !entry.name.endsWith('/'));
  if (!videoFile) {
    return null;
  }

  const videoPath = `${analysisPrefix}/${videoFile.name}`;
  const questionsPath = `${userId}/${analysisIdCandidate}/questions.json`;
  const annotationsPath = `${userId}/${analysisIdCandidate}/google-annotations.json`;

  const [questions, annotations] = await Promise.all([
    downloadJson<QuestionsPayload>('questions', questionsPath),
    downloadJson<AnnotationsPayload>('annotations', annotationsPath)
  ]);

  return {
    analysisId: analysisIdCandidate,
    fileName: questions?.fileName || videoFile.name.replace(/^video-/, '') || videoFile.name,
    analysisSummary:
      annotations?.normalizedAnalysis?.visualSummary || questions?.analysisSummary || 'Saved analysis',
    quizMomentCount: questions?.quizMoments?.length || 0,
    savedAt: questions?.savedAt || annotations?.savedAt || '',
    videoPath,
    questionsPath,
    annotationsPath
  };
}

export async function listSavedAnalyses(userId: string): Promise<SavedAnalysisEntry[]> {
  const { data: analysisFolders, error: listError } = await supabase.storage.from('videos').list(userId, {
    limit: 1000,
    sortBy: { column: 'name', order: 'desc' }
  });

  if (listError) {
    throw new Error(listError.message);
  }

  const folders = (analysisFolders ?? []).filter((entry) => entry.name && !entry.name.startsWith('.'));

  const entries = await Promise.all(folders.map((folder) => entryFromFolder(userId, folder.name)));

  return entries.filter((entry): entry is SavedAnalysisEntry => Boolean(entry));
}

export async function getSavedAnalysisById(userId: string, analysisId: string): Promise<SavedAnalysisEntry | null> {
  return entryFromFolder(userId, analysisId);
}

export async function loadPlaybackForEntry(item: SavedAnalysisEntry): Promise<LoadedPlayback> {
  const [questions, annotations, videoUrl] = await Promise.all([
    downloadJson<QuestionsPayload>('questions', item.questionsPath),
    downloadJson<AnnotationsPayload>('annotations', item.annotationsPath),
    downloadVideoObjectUrl(item.videoPath)
  ]);

  if (!questions?.quizMoments?.length) {
    throw new Error('Saved quiz moments were not found for this analysis.');
  }

  return {
    videoUrl,
    quizMoments: questions.quizMoments,
    analysisSummary: annotations?.normalizedAnalysis?.visualSummary || item.analysisSummary,
    sourceLabel: annotations?.normalizedAnalysis?.sourceLabel || 'google'
  };
}

export async function removeSavedAnalysis(userId: string, item: SavedAnalysisEntry) {
  const analysisPrefix = `${userId}/${item.analysisId}`;
  const { data: videoFiles, error: listVideoError } = await supabase.storage.from('videos').list(analysisPrefix, {
    limit: 100,
    sortBy: { column: 'name', order: 'asc' }
  });

  if (listVideoError) {
    throw new Error(listVideoError.message);
  }

  const videoPathsToRemove = (videoFiles ?? [])
    .filter((entry) => entry.name && !entry.name.endsWith('/'))
    .map((entry) => `${analysisPrefix}/${entry.name}`);

  const removals = await Promise.all([
    videoPathsToRemove.length > 0
      ? supabase.storage.from('videos').remove(videoPathsToRemove)
      : Promise.resolve({ data: [], error: null }),
    supabase.storage.from('questions').remove([item.questionsPath]),
    supabase.storage.from('annotations').remove([item.annotationsPath])
  ]);

  const firstError = removals.find((result) => result.error)?.error;
  if (firstError) {
    throw new Error(firstError.message);
  }
}
