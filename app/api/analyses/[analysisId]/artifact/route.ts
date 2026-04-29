import { readFile } from 'node:fs/promises';
import { NextResponse } from 'next/server';
import { readManifest, sanitizeAccountId } from '@/lib/analysis-storage';

export const runtime = 'nodejs';

export async function GET(request: Request, context: { params: { analysisId: string } }) {
  const { searchParams } = new URL(request.url);
  const accountId = sanitizeAccountId(searchParams.get('accountId') || '');
  const type = searchParams.get('type');

  if (!accountId) {
    return NextResponse.json({ error: 'accountId query parameter is required.' }, { status: 400 });
  }

  if (type !== 'google' && type !== 'openrouter') {
    return NextResponse.json({ error: 'type must be either "google" or "openrouter".' }, { status: 400 });
  }

  try {
    const manifest = await readManifest(accountId, context.params.analysisId);
    const filePath = type === 'google' ? manifest.googleAnnotationPath : manifest.openRouterResponsePath;
    const file = await readFile(filePath, 'utf8');

    return new NextResponse(file, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      }
    });
  } catch {
    return NextResponse.json({ error: 'Saved artifact was not found for this account.' }, { status: 404 });
  }
}