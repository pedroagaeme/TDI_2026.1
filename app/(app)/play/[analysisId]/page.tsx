'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { QuizPlayer } from '@/components/quiz-player';
import { useAuth } from '@/components/providers/auth-provider';
import { getSavedAnalysisById, loadPlaybackForEntry } from '@/lib/saved-analysis';
import type { QuizMoment } from '@/lib/types';

export default function PlayQuizPage() {
  const params = useParams();
  const analysisId = typeof params.analysisId === 'string' ? params.analysisId : '';
  const { userId } = useAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const videoUrlRef = useRef<string | null>(null);
  const [playback, setPlayback] = useState<{
    videoUrl: string;
    analysisSummary: string;
  } | null>(null);
  const [quizMoments, setQuizMoments] = useState<QuizMoment[]>([]);

  const revokeVideoUrl = useCallback(() => {
    const url = videoUrlRef.current;
    if (url?.startsWith('blob:')) {
      URL.revokeObjectURL(url);
    }
    videoUrlRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      revokeVideoUrl();
    };
  }, [revokeVideoUrl]);

  useEffect(() => {
    if (!analysisId) {
      setError('Missing video id.');
      setLoading(false);
      return;
    }

    if (!userId) {
      setLoading(false);
      return;
    }

    const accountId = userId;
    let cancelled = false;

    async function run() {
      setLoading(true);
      setError(null);
      revokeVideoUrl();
      setPlayback(null);
      setQuizMoments([]);

      try {
        const entry = await getSavedAnalysisById(accountId, analysisId);
        if (cancelled) {
          return;
        }

        if (!entry) {
          setError('This video was not found in your library.');
          setLoading(false);
          return;
        }

        const loaded = await loadPlaybackForEntry(entry);
        if (cancelled) {
          URL.revokeObjectURL(loaded.videoUrl);
          return;
        }

        videoUrlRef.current = loaded.videoUrl;
        setQuizMoments(loaded.quizMoments);
        setPlayback({
          videoUrl: loaded.videoUrl,
          analysisSummary: loaded.analysisSummary
        });
      } catch (e) {
        if (!cancelled) {
          setError((e as Error).message);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void run();

    return () => {
      cancelled = true;
      revokeVideoUrl();
    };
  }, [userId, analysisId, revokeVideoUrl]);

  return (
    <div className="flow-stack" style={{ maxWidth: 960 }}>
      <Link href="/videos" className="flow-back">
        ← Back to My videos
      </Link>

      <header className="hero" style={{ marginBottom: 8 }}>
        <div className="eyebrow">
          <span className="eyebrow-dot" />
          Quiz
        </div>
        <h1 className="title" style={{ fontSize: 'clamp(2rem, 5vw, 3.2rem)', maxWidth: 'none' }}>
          Play and guess
        </h1>
        <p className="muted" style={{ margin: 0 }}>
          The video pauses before each moment; pick the outcome that matches what happens next.
        </p>
      </header>

      {loading ? (
        <div className="panel">
          <div className="panel-inner stack">
            <div className="notice">Loading quiz…</div>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="panel">
          <div className="panel-inner stack">
            <div className="notice notice-error">{error}</div>
            <Link href="/videos" className="button button-secondary" style={{ textDecoration: 'none', width: 'fit-content' }}>
              Return to library
            </Link>
          </div>
        </div>
      ) : null}

      {!loading && !error && playback && quizMoments.length > 0 ? (
        <div className="panel">
          <div className="panel-inner stack">
            <QuizPlayer
              videoUrl={playback.videoUrl}
              quizMoments={quizMoments}
              analysisSummary={playback.analysisSummary}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
