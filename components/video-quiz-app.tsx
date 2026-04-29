'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { QuizPlayer } from '@/TDI_2026.1/components/quiz-player';
import { supabase } from '@/TDI_2026.1/lib/supabase-client';
import type { AnalyzeApiResponse, QuizMoment } from '@/TDI_2026.1/lib/types';

type RequestState = 'idle' | 'uploading' | 'analyzing' | 'ready' | 'error';
type AuthMode = 'login' | 'signup';

type SavedAnalysisEntry = {
  analysisId: string;
  fileName: string;
  analysisSummary: string;
  quizMomentCount: number;
  savedAt: string;
  videoPath: string;
  questionsPath: string;
  annotationsPath: string;
};

type QuestionsPayload = {
  fileName?: string;
  quizMoments?: QuizMoment[];
  savedAt?: string;
  analysisSummary?: string;
};

type AnnotationsPayload = {
  savedAt?: string;
  normalizedAnalysis?: {
    transcript?: string;
    visualSummary?: string;
    sourceLabel?: 'google' | 'mock';
  };
};

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function safeParseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export function VideoQuizApp() {
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const videoUrlRef = useRef<string | null>(null);
  const [savedAnalyses, setSavedAnalyses] = useState<SavedAnalysisEntry[]>([]);
  const [loadingSavedAnalyses, setLoadingSavedAnalyses] = useState(false);
  const [state, setState] = useState<RequestState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [analysisSummary, setAnalysisSummary] = useState('Upload a video to generate prediction moments.');
  const [quizMoments, setQuizMoments] = useState<QuizMoment[]>([]);
  const [sourceLabel, setSourceLabel] = useState<'google' | 'mock' | null>(null);
  const [analysisId, setAnalysisId] = useState<string | null>(null);

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

  async function downloadJson<T>(bucket: 'videos' | 'annotations' | 'questions', path: string) {
    const { data, error: downloadError } = await supabase.storage.from(bucket).download(path);
    if (downloadError || !data) {
      return null;
    }

    const text = await data.text();
    return safeParseJson<T>(text);
  }

  async function downloadVideoObjectUrl(path: string) {
    const { data, error: downloadError } = await supabase.storage.from('videos').download(path);

    if (downloadError || !data) {
      throw new Error(downloadError?.message || 'Failed to download video from Supabase Storage.');
    }

    return URL.createObjectURL(data);
  }

  async function loadSavedAnalyses(currentUserId: string) {
    setLoadingSavedAnalyses(true);

    try {
      const { data: analysisFolders, error: listError } = await supabase.storage.from('videos').list(currentUserId, {
        limit: 1000,
        sortBy: { column: 'name', order: 'desc' }
      });

      if (listError) {
        throw new Error(listError.message);
      }

      const folders = (analysisFolders ?? []).filter((entry) => entry.name && !entry.name.startsWith('.'));

      const entries = await Promise.all(
        folders.map(async (folder) => {
          const analysisIdCandidate = folder.name;
          const analysisPrefix = `${currentUserId}/${analysisIdCandidate}`;

          const { data: files, error: filesError } = await supabase.storage.from('videos').list(analysisPrefix, {
            limit: 100,
            sortBy: { column: 'name', order: 'asc' }
          });

          if (filesError) {
            throw new Error(filesError.message);
          }

          const videoFile = (files ?? []).find((entry) => entry.name.startsWith('video-') && !entry.name.endsWith('/'));
          if (!videoFile) {
            return null;
          }

          const videoPath = `${analysisPrefix}/${videoFile.name}`;
          const questionsPath = `${currentUserId}/${analysisIdCandidate}/questions.json`;
          const annotationsPath = `${currentUserId}/${analysisIdCandidate}/google-annotations.json`;

          const [questions, annotations] = await Promise.all([
            downloadJson<QuestionsPayload>('questions', questionsPath),
            downloadJson<AnnotationsPayload>('annotations', annotationsPath)
          ]);

          return {
            analysisId: analysisIdCandidate,
            fileName: questions?.fileName || videoFile.name.replace(/^video-/, '') || videoFile.name,
            analysisSummary:
              annotations?.normalizedAnalysis?.visualSummary || questions?.analysisSummary || 'Saved analysis',
            quizMomentCount: questions?.quizMoments?.length || 0,
            savedAt: questions?.savedAt || annotations?.savedAt || '',
            videoPath,
            questionsPath,
            annotationsPath
          } satisfies SavedAnalysisEntry;
        })
      );

      setSavedAnalyses(entries.filter((entry): entry is SavedAnalysisEntry => Boolean(entry)));
    } catch (savedError) {
      setError((savedError as Error).message);
    } finally {
      setLoadingSavedAnalyses(false);
    }
  }

  async function loadSavedAnalysisIntoPlayer(item: SavedAnalysisEntry) {
    try {
      setError(null);
      setState('analyzing');

      const [questions, annotations, nextVideoUrl] = await Promise.all([
        downloadJson<QuestionsPayload>('questions', item.questionsPath),
        downloadJson<AnnotationsPayload>('annotations', item.annotationsPath),
        downloadVideoObjectUrl(item.videoPath)
      ]);

      if (!questions?.quizMoments?.length) {
        throw new Error('Saved quiz moments were not found for this analysis.');
      }

      clearCurrentVideoUrl();
      setVideoUrl(nextVideoUrl);
      videoUrlRef.current = nextVideoUrl;
      setFile(null);
      setQuizMoments(questions.quizMoments);
      setAnalysisSummary(annotations?.normalizedAnalysis?.visualSummary || item.analysisSummary);
      setSourceLabel(annotations?.normalizedAnalysis?.sourceLabel || 'google');
      setAnalysisId(item.analysisId);
      setState('ready');
    } catch (savedLoadError) {
      setState('error');
      setError((savedLoadError as Error).message);
    }
  }

  function resetSession() {
    setFile(null);
    setQuizMoments([]);
    setAnalysisSummary('Upload a video to generate prediction moments.');
    setSourceLabel(null);
    setAnalysisId(null);
    setError(null);
    setState('idle');
    clearCurrentVideoUrl();
    setVideoUrl(null);
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;

    clearCurrentVideoUrl();
    setVideoUrl(null);
    setError(null);
    setQuizMoments([]);
    setSourceLabel(null);
    setAnalysisId(null);
    setAnalysisSummary('Upload a video to generate prediction moments.');
    setFile(selected);

    if (selected) {
      const nextUrl = URL.createObjectURL(selected);
      setVideoUrl(nextUrl);
      videoUrlRef.current = nextUrl;
    }
  }

  async function handleAuthSubmit() {
    setAuthMessage(null);
    setError(null);

    if (!email.trim() || !password) {
      setAuthMessage('Enter an email and password.');
      return;
    }

    try {
      if (authMode === 'signup') {
        const { error: signUpError } = await supabase.auth.signUp({ email: email.trim(), password });
        if (signUpError) {
          throw new Error(signUpError.message);
        }

        setAuthMessage('Account created. If email confirmation is enabled, check your inbox.');
        return;
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (signInError) {
        throw new Error(signInError.message);
      }

      setAuthMessage('Logged in successfully.');
    } catch (authError) {
      setAuthMessage((authError as Error).message);
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
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

    const analysisIdValue = crypto.randomUUID();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const videoPath = `${userId}/${analysisIdValue}/video-${safeName}`;

    const { error: uploadError } = await supabase.storage.from('videos').upload(videoPath, file, {
      upsert: false,
      contentType: file.type || 'video/mp4'
    });

    if (uploadError) {
      setState('error');
      setError(uploadError.message);
      return;
    }

    try {
      setState('analyzing');

      const analyzeResponse = await supabase.functions.invoke('analyze-google-video', {
        body: {
          analysisId: analysisIdValue,
          fileName: file.name,
          videoPath
        }
      });

      if (analyzeResponse.error) {
        throw new Error(analyzeResponse.error.message);
      }

      const analyzePayload = analyzeResponse.data as AnalyzeApiResponse & {
        normalizedAnalysis?: {
          transcript?: string;
          visualSummary?: string;
          sourceLabel?: 'google' | 'mock';
        };
      };

      const normalizedAnalysis = analyzePayload.normalizedAnalysis ?? {
        transcript: '',
        visualSummary: analyzePayload.analysisSummary,
        sourceLabel: analyzePayload.sourceLabel
      };

      const questionsResponse = await supabase.functions.invoke('generate-openrouter-questions', {
        body: {
          analysisId: analysisIdValue,
          fileName: file.name,
          normalizedAnalysis
        }
      });

      if (questionsResponse.error) {
        throw new Error(questionsResponse.error.message);
      }

      const questionsPayload = questionsResponse.data as {
        analysisId: string;
        quizMoments: QuizMoment[];
      };

      setQuizMoments(questionsPayload.quizMoments);
      setAnalysisSummary(normalizedAnalysis.visualSummary || analyzePayload.analysisSummary);
      setSourceLabel(normalizedAnalysis.sourceLabel || analyzePayload.sourceLabel || 'google');
      setAnalysisId(questionsPayload.analysisId || analysisIdValue);
      await loadSavedAnalyses(userId);
      setState('ready');
    } catch (analysisError) {
      setState('error');
      setError((analysisError as Error).message);
    }
  }

  useEffect(() => {
    let isMounted = true;

    async function initializeAuth() {
      const { data } = await supabase.auth.getSession();
      if (!isMounted) {
        return;
      }

      const session = data.session;
      setUserId(session?.user.id ?? null);
      setUserEmail(session?.user.email ?? null);
      setAuthLoading(false);
    }

    void initializeAuth();

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user.id ?? null);
      setUserEmail(session?.user.email ?? null);
      setError(null);
      setAuthMessage(null);
      setState('idle');

      if (!session?.user.id) {
        setSavedAnalyses([]);
        setLoadingSavedAnalyses(false);
        setQuizMoments([]);
        setAnalysisSummary('Upload a video to generate prediction moments.');
        setSourceLabel(null);
        setAnalysisId(null);
        setFile(null);
        clearCurrentVideoUrl();
        setVideoUrl(null);
      }
    });

    return () => {
      isMounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!userId) {
      setSavedAnalyses([]);
      return;
    }

    void loadSavedAnalyses(userId);
  }, [userId]);

  useEffect(() => {
    videoUrlRef.current = videoUrl;
  }, [videoUrl]);

  if (authLoading) {
    return (
      <main className="app-shell">
        <div className="ambient-grid" />
        <div className="page">
          <div className="panel">
            <div className="panel-inner stack">
              <h1 className="title" style={{ fontSize: 'clamp(2rem, 6vw, 3.5rem)', margin: 0 }}>
                Loading Supabase session…
              </h1>
              <p className="muted">Checking authentication state.</p>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <div className="ambient-grid" />
      <div className="page">
        <header className="hero">
          <div className="eyebrow">
            <span className="eyebrow-dot" />
            Supabase auth + storage + Edge Functions
          </div>
          <h1 className="title">Predict the next scene before it happens.</h1>
          <p className="subtitle">
            Create an account, upload a video to Supabase Storage, run Google Video Intelligence and OpenRouter in
            Edge Functions, then replay saved analyses from the buckets.
          </p>
        </header>

        <section className="layout">
          <div className="panel">
            <div className="panel-inner stack">
              <div>
                <h2 className="panel-heading">1. Account</h2>
                <p className="muted">Use Supabase Auth to create an account or log in before uploading.</p>
              </div>

              <div className="field">
                <label className="muted">Email</label>
                <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" />
              </div>

              <div className="field">
                <label className="muted">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Your password"
                />
              </div>

              <div className="actions">
                <button className="button button-primary" onClick={handleAuthSubmit}>
                  {authMode === 'signup' ? 'Create account' : 'Log in'}
                </button>
                <button
                  className="button button-secondary"
                  onClick={() => setAuthMode(authMode === 'signup' ? 'login' : 'signup')}
                >
                  Switch to {authMode === 'signup' ? 'login' : 'sign up'}
                </button>
              </div>

              {authMessage ? <div className="notice">{authMessage}</div> : null}

              {userId ? (
                <div className="notice notice-success">
                  Logged in as {userEmail || userId}
                  <div style={{ marginTop: 12 }}>
                    <button className="button button-secondary" onClick={handleSignOut}>
                      Sign out
                    </button>
                  </div>
                </div>
              ) : (
                <div className="notice">You need to log in to upload or load saved analyses.</div>
              )}
            </div>
          </div>

          <div className="panel">
            <div className="panel-inner stack">
              <div>
                <h2 className="panel-heading">2. Upload</h2>
                <p className="muted">
                  The file is uploaded to the videos bucket, then processed by the analyze and question Edge
                  Functions.
                </p>
              </div>

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
                <button className="button button-primary" onClick={handleAnalyze} disabled={!file || !userId || state === 'analyzing'}>
                  {state === 'uploading' || state === 'analyzing' ? 'Analyzing video…' : 'Generate quiz moments'}
                </button>
                <button className="button button-secondary" onClick={resetSession}>
                  Reset session
                </button>
              </div>

              {error ? <div className="notice notice-error">{error}</div> : null}
              {state === 'ready' ? (
                <div className="notice notice-success">
                  Quiz moments generated with {sourceLabel === 'google' ? 'Google Video Intelligence' : 'demo fallback'}.
                  {analysisId ? ` Saved as ${analysisId}.` : null}
                </div>
              ) : null}
            </div>
          </div>

          <div className="panel">
            <div className="panel-inner stack">
              <div>
                <h2 className="panel-heading">3. Play and answer</h2>
                <p className="muted">
                  Once analysis is done, the video pauses at each timestamp and presents two plausible outcomes.
                </p>
              </div>

              {videoUrl && quizMoments.length > 0 ? (
                <QuizPlayer videoUrl={videoUrl} quizMoments={quizMoments} analysisSummary={analysisSummary} />
              ) : (
                <div className="notice">
                  {videoUrl
                    ? 'Run analysis to unlock the quiz player.'
                    : 'Upload a video to preview the player and start generating prediction prompts.'}
                </div>
              )}
            </div>
          </div>

          <div className="panel">
            <div className="panel-inner stack">
              <div>
                <h2 className="panel-heading">4. Saved analyses</h2>
                <p className="muted">Browse previously processed items from your authenticated storage folders.</p>
              </div>

              {!userId ? (
                <div className="notice">Log in to view saved analyses.</div>
              ) : loadingSavedAnalyses ? (
                <div className="notice">Loading saved videos…</div>
              ) : savedAnalyses.length === 0 ? (
                <div className="notice">No saved videos yet for this account.</div>
              ) : (
                <div className="result-list">
                  {savedAnalyses.map((item) => (
                    <div className="result-row" key={item.analysisId}>
                      <div className="result-row-top">
                        <strong>{item.fileName}</strong>
                        <span className="chip">{item.quizMomentCount} moments</span>
                      </div>
                      <div className="muted">Saved: {new Date(item.savedAt).toLocaleString()}</div>
                      <div className="muted">{item.analysisSummary}</div>
                      <div className="actions" style={{ marginTop: 10 }}>
                        <button className="button button-primary" onClick={() => void loadSavedAnalysisIntoPlayer(item)}>
                          Load in player
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}