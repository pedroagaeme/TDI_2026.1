import { NextResponse } from 'next/server';
import { tasks } from '@trigger.dev/sdk';
import { sanitizeAccountId } from '@/lib/analysis-storage';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';
import type { analyzeVideoTask } from '@/trigger/analyze-video';

export const runtime = 'nodejs';

function toMb(size: number) {
  return Math.round((size / 1024 / 1024) * 10) / 10;
}

export async function POST(request: Request) {
  console.log('[/api/analyze] POST request received');
  
  try {
    const formData = await request.formData();
  const uploaded = formData.get('video');
  const accountIdValue = formData.get('accountId');
  const accountId = sanitizeAccountId(typeof accountIdValue === 'string' ? accountIdValue : '');

    console.log('[/api/analyze] accountId:', accountId, 'uploaded:', uploaded instanceof File ? 'File' : typeof uploaded);

  if (!accountId) {
      console.warn('[/api/analyze] Account ID missing');
    return NextResponse.json({ error: 'Account ID is required.' }, { status: 400 });
  }

  if (!(uploaded instanceof File)) {
      console.warn('[/api/analyze] uploaded is not a File:', typeof uploaded);
    return NextResponse.json({ error: 'Please upload a video file.' }, { status: 400 });
  }

  if (!uploaded.type.startsWith('video/')) {
      console.warn('[/api/analyze] File type not video:', uploaded.type);
    return NextResponse.json({ error: 'The selected file must be a video.' }, { status: 400 });
  }

  if (uploaded.size > 80 * 1024 * 1024) {
      console.warn('[/api/analyze] File too large:', toMb(uploaded.size), 'MB');
    return NextResponse.json(
      { error: `Video is too large (${toMb(uploaded.size)} MB). Keep it below 80 MB for this version.` },
      { status: 413 }
    );
  }

  const analysisId = crypto.randomUUID();
  const safeName = uploaded.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const videoObjectPath = `${accountId}/${analysisId}/video-${safeName}`;

    console.log('[/api/analyze] Uploading video to Supabase:', videoObjectPath);
    const supabase = createSupabaseAdminClient();
    const { error: uploadError } = await supabase.storage.from('videos').upload(videoObjectPath, Buffer.from(await uploaded.arrayBuffer()), {
      contentType: uploaded.type || 'video/mp4',
      upsert: false
    });

    if (uploadError) {
      console.error('[/api/analyze] Supabase upload error:', uploadError);
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }

    console.log('[/api/analyze] Video uploaded, triggering Trigger.dev task');
    const handle = await tasks.trigger<typeof analyzeVideoTask>('analyze-video', {
      analysisId,
      accountId,
      fileName: uploaded.name,
      videoObjectPath
    });

    console.log('[/api/analyze] Task triggered with runId:', handle.id);
    return NextResponse.json({
      analysisId,
      runId: handle.id,
      videoObjectPath,
      status: 'queued'
    });
  } catch (error) {
    const errorMsg = (error as Error).message || 'Failed to analyze the uploaded video.';
    console.error('[/api/analyze] Error:', errorMsg, error);
    return NextResponse.json(
      {
        error: errorMsg,
        details: error instanceof Error ? error.stack : undefined
      },
      { status: 500 }
    );
  }
}
