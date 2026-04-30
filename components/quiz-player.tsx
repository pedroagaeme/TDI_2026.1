'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { QuizAnswer, QuizMoment } from '@/lib/types';

interface QuizPlayerProps {
  videoUrl: string;
  quizMoments: QuizMoment[];
  analysisSummary: string;
}

function formatSeconds(value: number) {
  const whole = Math.max(0, Math.floor(value));
  const minutes = Math.floor(whole / 60);
  const seconds = whole % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function getFullscreenElement(): Element | null {
  const doc = document as Document & {
    webkitFullscreenElement?: Element | null;
    mozFullScreenElement?: Element | null;
  };
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? doc.mozFullScreenElement ?? null;
}

async function requestContainerFullscreen(el: HTMLElement) {
  const anyEl = el as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void> | void;
    mozRequestFullScreen?: () => Promise<void> | void;
  };
  if (el.requestFullscreen) {
    await el.requestFullscreen();
  } else if (anyEl.webkitRequestFullscreen) {
    await Promise.resolve(anyEl.webkitRequestFullscreen());
  } else if (anyEl.mozRequestFullScreen) {
    await Promise.resolve(anyEl.mozRequestFullScreen());
  }
}

async function exitFullscreen() {
  const doc = document as Document & {
    webkitExitFullscreen?: () => Promise<void> | void;
    mozCancelFullScreen?: () => Promise<void> | void;
  };
  if (document.exitFullscreen) {
    await document.exitFullscreen();
  } else if (doc.webkitExitFullscreen) {
    await Promise.resolve(doc.webkitExitFullscreen());
  } else if (doc.mozCancelFullScreen) {
    await Promise.resolve(doc.mozCancelFullScreen());
  }
}

export function QuizPlayer({ videoUrl, quizMoments, analysisSummary }: QuizPlayerProps) {
  const fsRootRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [answers, setAnswers] = useState<QuizAnswer[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [promptOpen, setPromptOpen] = useState(false);
  const [overlayFading, setOverlayFading] = useState(false);
  const [lastChoice, setLastChoice] = useState<string | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [ended, setEnded] = useState(false);
  /** When true, left card shows the correct answer; when false, left shows the decoy. */
  const [correctOnLeft, setCorrectOnLeft] = useState(true);
  const [fsActive, setFsActive] = useState(false);

  const playableMoments = useMemo(() => {
    if (!duration) {
      return quizMoments;
    }

    return quizMoments.filter((moment) => moment.timestamp < Math.max(1, duration - 0.25));
  }, [duration, quizMoments]);

  const currentMoment = playableMoments[currentIndex];
  const score = answers.filter((answer) => answer.isCorrect).length;

  useEffect(() => {
    setAnswers([]);
    setCurrentIndex(0);
    setPromptOpen(false);
    setOverlayFading(false);
    setLastChoice(null);
    setEnded(false);
    setCorrectOnLeft(true);

    if (overlayTimeoutRef.current) {
      clearTimeout(overlayTimeoutRef.current);
      overlayTimeoutRef.current = null;
    }
  }, [videoUrl, quizMoments]);

  useEffect(() => {
    return () => {
      if (overlayTimeoutRef.current) {
        clearTimeout(overlayTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    function syncFs() {
      const root = fsRootRef.current;
      setFsActive(Boolean(root && getFullscreenElement() === root));
    }

    document.addEventListener('fullscreenchange', syncFs);
    document.addEventListener('webkitfullscreenchange', syncFs);
    document.addEventListener('mozfullscreenchange', syncFs);
    syncFs();

    return () => {
      document.removeEventListener('fullscreenchange', syncFs);
      document.removeEventListener('webkitfullscreenchange', syncFs);
      document.removeEventListener('mozfullscreenchange', syncFs);
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !currentMoment || ended) {
      return undefined;
    }

    const threshold = Math.max(0, currentMoment.timestamp - 0.35);

    const handleTimeUpdate = () => {
      if (!promptOpen && video.currentTime >= threshold) {
        video.pause();
        setCorrectOnLeft(Math.random() < 0.5);
        setOverlayFading(false);
        setPromptOpen(true);
      }
    };

    const handleEnded = () => {
      setEnded(true);
      setPromptOpen(false);
    };

    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('ended', handleEnded);

    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('ended', handleEnded);
    };
  }, [currentMoment, ended, promptOpen]);

  function handleMetadataLoaded() {
    const video = videoRef.current;
    if (video) {
      setDuration(video.duration);
    }
  }

  async function handleToggleFullscreen() {
    const root = fsRootRef.current;
    if (!root) {
      return;
    }
    try {
      if (getFullscreenElement() === root) {
        await exitFullscreen();
      } else {
        await requestContainerFullscreen(root);
      }
    } catch {
      /* user denied or API unsupported */
    }
  }

  function resolveChoice(selected: 'correct' | 'wrong') {
    if (!currentMoment || overlayFading) {
      return;
    }

    const selectedText = selected === 'correct' ? currentMoment.correct_option_text : currentMoment.wrong_option_text;
    const isCorrect = selected === 'correct';

    setAnswers((currentAnswers) => [
      ...currentAnswers,
      {
        timestamp: currentMoment.timestamp,
        selected: selectedText,
        correct: currentMoment.correct_option_text,
        isCorrect
      }
    ]);
    setLastChoice(selectedText);
    setOverlayFading(true);

    if (overlayTimeoutRef.current) {
      clearTimeout(overlayTimeoutRef.current);
    }

    const video = videoRef.current;
    overlayTimeoutRef.current = setTimeout(() => {
      setPromptOpen(false);
      setOverlayFading(false);
      setCurrentIndex((value) => value + 1);

      if (video) {
        video.currentTime = currentMoment.timestamp + 0.2;
        void video.play();
      }
    }, 380);
  }

  const total = playableMoments.length;

  const leftChoice = correctOnLeft ? ('correct' as const) : ('wrong' as const);
  const rightChoice = correctOnLeft ? ('wrong' as const) : ('correct' as const);
  const leftText = correctOnLeft ? currentMoment?.correct_option_text : currentMoment?.wrong_option_text;
  const rightText = correctOnLeft ? currentMoment?.wrong_option_text : currentMoment?.correct_option_text;

  return (
    <div className="player-wrap">
      <div className="panel">
        <div className="panel-inner stack">
          <div className="quiz-header">
            <div>
              <h2 className="panel-heading">Playback and prompts</h2>
              <div className="muted">
                {total} prediction moment{total === 1 ? '' : 's'} · score {score}/{answers.length || total || 1}
              </div>
            </div>
            <span className="chip">{ended ? 'Video complete' : promptOpen ? 'Paused for quiz' : 'Playing ready'}</span>
          </div>

          <div className="video-frame video-frame-fs-root" ref={fsRootRef}>
            <div className="video-stack">
              <video
                ref={videoRef}
                controls
                playsInline
                controlsList="nofullscreen"
                className="video-quiz-element"
                src={videoUrl}
                onLoadedMetadata={handleMetadataLoaded}
              />

              {currentMoment && promptOpen ? (
                <div
                  className={`video-quiz-overlay ${overlayFading ? 'is-fading' : ''}`}
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="quiz-overlay-title"
                >
                  <div className="video-quiz-overlay-scrim" aria-hidden />
                  <div className="video-quiz-overlay-card">
                    <div className="video-quiz-overlay-header">
                      <span className="video-quiz-overlay-badge">{formatSeconds(currentMoment.timestamp)}</span>
                      <h3 id="quiz-overlay-title" className="video-quiz-overlay-title">
                        What happens next?
                      </h3>
                      <p className="video-quiz-overlay-hint">Choose the outcome that matches the very next moment.</p>
                    </div>
                    <div className="video-quiz-overlay-options">
                      <button
                        type="button"
                        className="video-quiz-option"
                        data-slot="left"
                        onClick={() => resolveChoice(leftChoice)}
                        disabled={overlayFading}
                      >
                        <span className="video-quiz-option-label">Prediction 1</span>
                        <span className="video-quiz-option-text">{leftText}</span>
                      </button>
                      <button
                        type="button"
                        className="video-quiz-option"
                        data-slot="right"
                        onClick={() => resolveChoice(rightChoice)}
                        disabled={overlayFading}
                      >
                        <span className="video-quiz-option-label">Prediction 2</span>
                        <span className="video-quiz-option-text">{rightText}</span>
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="video-fs-bar">
              <button type="button" className="button button-secondary video-fs-bar-btn" onClick={() => void handleToggleFullscreen()}>
                {fsActive ? 'Exit full screen' : 'Full screen (quiz visible)'}
              </button>
              <span className="video-fs-bar-hint muted">Native video full screen hides the quiz — use this button.</span>
            </div>
          </div>
        </div>
      </div>

      <div className="layout">
        <div className="panel">
          <div className="panel-inner quiz-card">
            <div>
              <h3 className="panel-heading">What happens next?</h3>
              <p className="quiz-prompt">
                {currentMoment
                  ? `Pause at ${formatSeconds(currentMoment.timestamp)} and choose the most likely continuation.`
                  : ended
                    ? 'No more moments remain. Review your score below.'
                    : 'Load a video to start the prediction quiz.'}
              </p>
            </div>

            <div className="notice">
              {currentMoment
                ? 'The overlay appears over the player (and stays visible in full screen when you use the button below the video).'
                : 'The quiz overlay appears automatically when the video reaches generated timestamps.'}
            </div>

            {lastChoice ? <div className="notice notice-success">Last answer recorded: {lastChoice}</div> : null}
          </div>
        </div>

        <div className="panel">
          <div className="panel-inner stack">
            <div>
              <h3 className="panel-heading">Analysis summary</h3>
              <p className="muted" style={{ lineHeight: 1.65, margin: 0 }}>
                {analysisSummary}
              </p>
            </div>

            <div className="score-grid">
              <div className="score-card">
                Total prompts
                <span className="score-value">{total}</span>
              </div>
              <div className="score-card">
                Correct
                <span className="score-value">{score}</span>
              </div>
              <div className="score-card">
                Accuracy
                <span className="score-value">{total ? Math.round((score / total) * 100) : 0}%</span>
              </div>
            </div>

            <div>
              <h3 className="panel-heading">Results</h3>
              <div className="result-list">
                {answers.length === 0 ? (
                  <div className="notice">No answers recorded yet.</div>
                ) : (
                  answers.map((answer) => (
                    <div className="result-row" key={`${answer.timestamp}-${answer.selected}`}>
                      <div className="result-row-top">
                        <strong>{formatSeconds(answer.timestamp)}</strong>
                        <span className={`badge ${answer.isCorrect ? 'badge-correct' : 'badge-wrong'}`}>
                          {answer.isCorrect ? 'Correct' : 'Wrong'}
                        </span>
                      </div>
                      <div className="muted">Your answer: {answer.selected}</div>
                      <div className="muted">Correct answer: {answer.correct}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
