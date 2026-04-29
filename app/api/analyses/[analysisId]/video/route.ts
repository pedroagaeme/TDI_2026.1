import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { NextResponse } from 'next/server';
import { readManifest, sanitizeAccountId } from '@/lib/analysis-storage';

export const runtime = 'nodejs';

const EXT_TO_MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.m4v': 'video/x-m4v'
};

export async function GET(request: Request, context: { params: { analysisId: string } }) {
  const { searchParams } = new URL(request.url);
  const accountId = sanitizeAccountId(searchParams.get('accountId') || '');

  if (!accountId) {
    return NextResponse.json({ error: 'accountId query parameter is required.' }, { status: 400 });
  }

  try {
    const manifest = await readManifest(accountId, context.params.analysisId);
    const file = await readFile(manifest.videoPath);
    const extension = extname(manifest.videoPath).toLowerCase();
    const contentType = EXT_TO_MIME[extension] || 'application/octet-stream';

    return new NextResponse(file, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'no-store'
      }
    });
  } catch {
    return NextResponse.json({ error: 'Saved video was not found for this account.' }, { status: 404 });
  }
}