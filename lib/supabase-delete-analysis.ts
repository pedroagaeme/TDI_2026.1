import type { SupabaseClient } from '@supabase/supabase-js';

function isMissingObjectError(error: { message: string; statusCode?: string } | null) {
  if (!error) {
    return false;
  }
  const message = error.message.toLowerCase();
  return message.includes('not found') || message.includes('404') || error.statusCode === '404';
}

/**
 * Removes one analysis folder from the `videos` bucket and matching JSON objects
 * in `questions` and `annotations`. Caller must use a service-role client and
 * have already verified `userId` owns this `analysisId`.
 */
export async function deleteUserAnalysisFromStorage(
  admin: SupabaseClient,
  userId: string,
  analysisId: string
) {
  const analysisPrefix = `${userId}/${analysisId}`;

  const { data: videoFiles, error: listVideoError } = await admin.storage.from('videos').list(analysisPrefix, {
    limit: 100,
    sortBy: { column: 'name', order: 'asc' }
  });

  if (listVideoError) {
    throw new Error(listVideoError.message);
  }

  const videoPathsToRemove = (videoFiles ?? [])
    .filter((entry) => entry.name && !entry.name.endsWith('/'))
    .map((entry) => `${analysisPrefix}/${entry.name}`);

  if (videoPathsToRemove.length > 0) {
    const { error } = await admin.storage.from('videos').remove(videoPathsToRemove);
    if (error) {
      throw new Error(error.message);
    }
  }

  const questionsPath = `${userId}/${analysisId}/questions.json`;
  const annotationsPath = `${userId}/${analysisId}/google-annotations.json`;

  const { error: questionsError } = await admin.storage.from('questions').remove([questionsPath]);
  if (questionsError && !isMissingObjectError(questionsError)) {
    throw new Error(questionsError.message);
  }

  const { error: annotationsError } = await admin.storage.from('annotations').remove([annotationsPath]);
  if (annotationsError && !isMissingObjectError(annotationsError)) {
    throw new Error(annotationsError.message);
  }
}
