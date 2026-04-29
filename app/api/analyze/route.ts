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
    const contentType = request.headers.get('content-type') || '';

    let accountId = '';
    let analysisId = '';
    let fileName = '';
    let videoObjectPath: string | null = null;

    if (contentType.includes('application/json')) {
      // Client uploaded the video directly to Supabase and is sending a small JSON payload
      const body = await request.json();
      accountId = sanitizeAccountId(typeof body.accountId === 'string' ? body.accountId : '');
      analysisId = typeof body.analysisId === 'string' && body.analysisId ? body.analysisId : crypto.randomUUID();
      fileName = typeof body.fileName === 'string' ? body.fileName : 'video.mp4';
      videoObjectPath = typeof body.videoObjectPath === 'string' ? body.videoObjectPath : null;

      console.log('[/api/analyze] JSON payload received', { accountId, analysisId, fileName, videoObjectPath });
    } else {
      // Fallback: accept multipart/form-data with the file (smaller files only)
      const formData = await request.formData();
      const uploaded = formData.get('video');
      const accountIdValue = formData.get('accountId');
      accountId = sanitizeAccountId(typeof accountIdValue === 'string' ? accountIdValue : '');

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

      analysisId = crypto.randomUUID();
      fileName = uploaded.name;
      const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
      videoObjectPath = `${accountId}/${analysisId}/video-${safeName}`;

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
    }

    if (!accountId) {
      return NextResponse.json({ error: 'Account ID is required.' }, { status: 400 });
    }

    if (!videoObjectPath) {
      return NextResponse.json({ error: 'videoObjectPath is required.' }, { status: 400 });
    }

    console.log('[/api/analyze] Triggering Trigger.dev task for', videoObjectPath);
    const handle = await tasks.trigger<typeof analyzeVideoTask>('analyze-video', {
      analysisId,
      accountId,
      fileName,
      videoObjectPath
    });

    console.log('[/api/analyze] Task triggered with runId:', handle.id);
    return NextResponse.json({ analysisId, runId: handle.id, videoObjectPath, status: 'queued' });
  } catch (error) {
    const errorMsg = (error as Error).message || 'Failed to analyze the uploaded video.';
    console.error('[/api/analyze] Error:', errorMsg, error);
    return NextResponse.json({ error: errorMsg, details: error instanceof Error ? error.stack : undefined }, { status: 500 });
  }
}
