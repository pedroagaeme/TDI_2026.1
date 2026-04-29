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
  const formData = await request.formData();
  const uploaded = formData.get('video');
  const accountIdValue = formData.get('accountId');
  const accountId = sanitizeAccountId(typeof accountIdValue === 'string' ? accountIdValue : '');

  if (!accountId) {
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

  const analysisId = crypto.randomUUID();
  const safeName = uploaded.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const videoObjectPath = `${accountId}/${analysisId}/video-${safeName}`;

  try {
    const supabase = createSupabaseAdminClient();
    const { error: uploadError } = await supabase.storage.from('videos').upload(videoObjectPath, Buffer.from(await uploaded.arrayBuffer()), {
      contentType: uploaded.type || 'video/mp4',
      upsert: false
    });

    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }

    const handle = await tasks.trigger<typeof analyzeVideoTask>('analyze-video', {
      analysisId,
      accountId,
      fileName: uploaded.name,
      videoObjectPath
    });

    return NextResponse.json({
      analysisId,
      runId: handle.id,
      videoObjectPath,
      status: 'queued'
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: (error as Error).message || 'Failed to analyze the uploaded video.'
      },
      { status: 500 }
    );
  }
}
