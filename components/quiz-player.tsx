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

export function QuizPlayer({ videoUrl, quizMoments, analysisSummary }: QuizPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [answers, setAnswers] = useState<QuizAnswer[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [promptOpen, setPromptOpen] = useState(false);
  const [lastChoice, setLastChoice] = useState<string | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [ended, setEnded] = useState(false);

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
    setLastChoice(null);
    setEnded(false);
  }, [videoUrl, quizMoments]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !currentMoment || ended) {
      return undefined;
    }

    const threshold = Math.max(0, currentMoment.timestamp - 0.35);

    const handleTimeUpdate = () => {
      if (!promptOpen && video.currentTime >= threshold) {
        video.pause();
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

  function resolveChoice(selected: 'correct' | 'wrong') {
    if (!currentMoment) {
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
    setPromptOpen(false);
    setCurrentIndex((value) => value + 1);

    const video = videoRef.current;
    if (video) {
      video.currentTime = currentMoment.timestamp + 0.2;
      void video.play();
    }
  }

  const total = playableMoments.length;

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
          <div className="video-frame">
            <video ref={videoRef} controls src={videoUrl} onLoadedMetadata={handleMetadataLoaded} />
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

            {currentMoment ? (
              <div className="option-grid">
                <button
                  className="option-button"
                  data-choice="correct"
                  onClick={() => resolveChoice('correct')}
                  disabled={!promptOpen && total > 0 && currentIndex > 0}
                >
                  <strong>Option A</strong>
                  {currentMoment.correct_option_text}
                </button>
                <button
                  className="option-button"
                  data-choice="wrong"
                  onClick={() => resolveChoice('wrong')}
                  disabled={!promptOpen && total > 0 && currentIndex > 0}
                >
                  <strong>Option B</strong>
                  {currentMoment.wrong_option_text}
                </button>
              </div>
            ) : (
              <div className="notice">The quiz will appear once the video starts reaching the generated timestamps.</div>
            )}

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
