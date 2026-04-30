import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { deleteUserAnalysisFromStorage } from '@/lib/supabase-delete-analysis';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';

export const runtime = 'nodejs';

const ANALYSIS_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getBearerToken(request: Request) {
  const raw = request.headers.get('authorization') || request.headers.get('Authorization');
  const token = raw?.replace(/^Bearer\s+/i, '')?.trim();
  return token || null;
}

export async function DELETE(request: Request, context: { params: { analysisId: string } }) {
  const analysisId = context.params.analysisId;

  if (!analysisId || !ANALYSIS_ID_RE.test(analysisId)) {
    return NextResponse.json({ error: 'Invalid analysis id.' }, { status: 400 });
  }

  const token = getBearerToken(request);
  if (!token) {
    return NextResponse.json({ error: 'Authorization: Bearer <access_token> is required.' }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

  if (!supabaseUrl || !anonKey) {
    return NextResponse.json({ error: 'Server is missing Supabase URL or anon key.' }, { status: 500 });
  }

  const authClient = createClient(supabaseUrl, anonKey);
  const { data: userData, error: authError } = await authClient.auth.getUser(token);

  if (authError || !userData.user?.id) {
    return NextResponse.json({ error: 'Invalid or expired session.' }, { status: 401 });
  }

  const userId = userData.user.id;

  try {
    const admin = createSupabaseAdminClient();
    await deleteUserAnalysisFromStorage(admin, userId, analysisId);
  } catch (e) {
    const message = (e as Error).message || 'Failed to delete storage objects.';
    console.error('[DELETE /api/analyses/[analysisId]]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
