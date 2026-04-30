'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/providers/auth-provider';
import { listSavedAnalyses, removeSavedAnalysis, type SavedAnalysisEntry } from '@/lib/saved-analysis';

export default function VideosPage() {
  const { userId } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<SavedAnalysisEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!userId) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const next = await listSavedAnalyses(userId);
      setItems(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleDelete(item: SavedAnalysisEntry) {
    if (!userId) {
      return;
    }

    const confirmed =
      typeof window === 'undefined'
        ? true
        : window.confirm(`Delete "${item.fileName}" and all related quiz artifacts? This cannot be undone.`);

    if (!confirmed) {
      return;
    }

    setDeletingId(item.analysisId);
    setError(null);
    setToast(null);

    try {
      await removeSavedAnalysis(item);
      setToast(`Deleted ${item.fileName}.`);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="flow-stack">
      <header className="hero" style={{ marginBottom: 8 }}>
        <div className="eyebrow">
          <span className="eyebrow-dot" />
          Library
        </div>
        <h1 className="title" style={{ fontSize: 'clamp(2rem, 5vw, 3.2rem)', maxWidth: 'none' }}>
          My videos
        </h1>
        <p className="subtitle">Open a saved quiz or remove videos you no longer need.</p>
      </header>

      <div className="actions" style={{ marginBottom: 4 }}>
        <Link href="/upload" className="button button-primary" style={{ textDecoration: 'none', display: 'inline-flex' }}>
          Upload new video
        </Link>
      </div>

      <div className="panel">
        <div className="panel-inner stack">
          {toast ? <div className="notice notice-success">{toast}</div> : null}
          {error ? <div className="notice notice-error">{error}</div> : null}

          {!userId ? (
            <div className="notice">You must be logged in.</div>
          ) : loading ? (
            <div className="notice">Loading saved videos…</div>
          ) : items.length === 0 ? (
            <div className="notice">
              No saved videos yet.{' '}
              <Link href="/upload" className="flow-back">
                Upload a video
              </Link>{' '}
              to generate your first quiz.
            </div>
          ) : (
            <div className="result-list result-list-tall">
              {items.map((item) => (
                <div className="result-row" key={item.analysisId}>
                  <div className="result-row-top">
                    <strong>{item.fileName}</strong>
                    <span className="chip">{item.quizMomentCount} moments</span>
                  </div>
                  <div className="muted">Saved: {item.savedAt ? new Date(item.savedAt).toLocaleString() : '—'}</div>
                  <div className="muted">{item.analysisSummary}</div>
                  <div className="actions" style={{ marginTop: 10 }}>
                    <button
                      type="button"
                      className="button button-primary"
                      onClick={() => router.push(`/play/${item.analysisId}`)}
                    >
                      Play quiz
                    </button>
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={() => void handleDelete(item)}
                      disabled={deletingId === item.analysisId}
                    >
                      {deletingId === item.analysisId ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
