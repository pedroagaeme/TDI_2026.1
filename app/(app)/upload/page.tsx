'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/providers/auth-provider';
import { formatBytes } from '@/lib/saved-analysis';
import { supabase } from '@/lib/supabase-client';

type RequestState = 'idle' | 'uploading' | 'analyzing' | 'ready' | 'error';

export default function UploadPage() {
  const { userId } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const videoUrlRef = useRef<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [state, setState] = useState<RequestState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [analysisId, setAnalysisId] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const fileLabel = useMemo(() => {
    if (!file) {
      return 'No video selected yet.';
    }
    return `${file.name} · ${formatBytes(file.size)}`;
  }, [file]);

  function clearCurrentVideoUrl() {
    const currentUrl = videoUrlRef.current;
    if (currentUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(currentUrl);
    }
    videoUrlRef.current = null;
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    clearCurrentVideoUrl();
    setVideoUrl(null);
    setError(null);
    setAnalysisId(null);
    setBanner(null);
    setState('idle');
    setFile(selected);

    if (selected) {
      const nextUrl = URL.createObjectURL(selected);
      setVideoUrl(nextUrl);
      videoUrlRef.current = nextUrl;
    }
  }

  async function handleAnalyze() {
    if (!userId) {
      setError('Log in first.');
      return;
    }

    if (!file) {
      setError('Pick a video first.');
      return;
    }

    setState('uploading');
    setError(null);
    setBanner(null);

    try {
      setState('analyzing');
      const analysisIdValue = crypto.randomUUID();
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const videoObjectPath = `${userId}/${analysisIdValue}/video-${safeName}`;

      const { error: uploadError } = await supabase.storage.from('videos').upload(videoObjectPath, file, {
        upsert: false,
        contentType: file.type || 'video/mp4'
      });

      if (uploadError) {
        setState('error');
        setError(uploadError.message);
        return;
      }

      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: userId,
          analysisId: analysisIdValue,
          fileName: file.name,
          videoObjectPath
        })
      });

      const payload = (await response.json().catch(() => null)) as
        | { analysisId?: string; runId?: string; status?: string; error?: string; details?: string }
        | null;

      if (!response.ok) {
        throw new Error(payload?.error || `Request failed with status ${response.status}`);
      }

      setAnalysisId(payload?.analysisId ?? analysisIdValue);
      setState('ready');
      setBanner('Analysis queued. When it finishes, open My videos to play the quiz.');
    } catch (analysisError) {
      setState('error');
      setError((analysisError as Error).message);
    }
  }

  return (
    <div className="flow-stack">
      <header className="hero" style={{ marginBottom: 8 }}>
        <div className="eyebrow">
          <span className="eyebrow-dot" />
          New upload
        </div>
        <h1 className="title" style={{ fontSize: 'clamp(2rem, 5vw, 3.2rem)', maxWidth: 'none' }}>
          Upload a video
        </h1>
        <p className="subtitle">
          Files go to Supabase Storage, then Google Video Intelligence and your Edge pipeline generate prediction
          moments.
        </p>
      </header>

      <div className="panel">
        <div className="panel-inner stack">
          <div className="field">
            <label className="dropzone">
              <div className="stack" style={{ gap: 8 }}>
                <strong>Select a video file</strong>
                <span className="muted">MP4, MOV, WebM, or other browser-playable formats.</span>
                <input type="file" accept="video/*" onChange={handleFileChange} />
              </div>
            </label>

            <div className="meta-row">
              <span>{fileLabel}</span>
              <span>{file ? 'Ready to analyze' : 'Waiting for a video'}</span>
            </div>
          </div>

          <div className="actions">
            <button
              type="button"
              className="button button-primary"
              onClick={() => void handleAnalyze()}
              disabled={!file || !userId || state === 'analyzing'}
            >
              {state === 'uploading' || state === 'analyzing' ? 'Analyzing video…' : 'Generate quiz moments'}
            </button>
            <Link href="/videos" className="button button-secondary" style={{ textDecoration: 'none', display: 'inline-flex' }}>
              Back to library
            </Link>
          </div>

          {error ? <div className="notice notice-error">{error}</div> : null}
          {banner ? (
            <div className="notice notice-success">
              {banner}
              {analysisId ? ` Analysis id: ${analysisId}.` : null}{' '}
              <Link href="/videos" className="flow-back" style={{ color: 'inherit', fontWeight: 700 }}>
                Go to My videos →
              </Link>
            </div>
          ) : null}
        </div>
      </div>

      {videoUrl ? (
        <div className="panel">
          <div className="panel-inner stack">
            <h2 className="panel-heading">Preview</h2>
            <p className="muted">Local preview only — the quiz appears after processing completes.</p>
            <div className="video-frame">
              <video src={videoUrl} controls playsInline />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
