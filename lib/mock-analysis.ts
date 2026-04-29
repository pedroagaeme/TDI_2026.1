import type { NormalizedVideoAnalysis, QuizMoment } from '@/lib/types';

const fallbackQuizMoments: QuizMoment[] = [
  {
    timestamp: 8,
    correct_option_text: 'The person opens the next door and walks through.',
    wrong_option_text: 'The scene cuts to a completely different location.'
  },
  {
    timestamp: 22,
    correct_option_text: 'The object slips from their hand and falls.',
    wrong_option_text: 'The object starts floating upward without warning.'
  },
  {
    timestamp: 36,
    correct_option_text: 'The crowd reacts with surprise and moves closer.',
    wrong_option_text: 'Everyone immediately leaves the room quietly.'
  }
];

export function createMockAnalysis(fileName: string): NormalizedVideoAnalysis {
  return {
    transcript: `Demo transcript for ${fileName}. A character enters a room, notices something unexpected, and the pace changes quickly.`,
    visualSummary:
      'Demo visual summary: a person walks into a room, handles an object, then a crowd responds to a surprising moment.',
    cues: [
      {
        timestamp: 8,
        source: 'fallback',
        description: 'Character prepares to open a door.'
      },
      {
        timestamp: 22,
        source: 'fallback',
        description: 'Important object is in motion.'
      },
      {
        timestamp: 36,
        source: 'fallback',
        description: 'Audience or crowd reaction builds.'
      }
    ],
    sourceLabel: 'mock'
  };
}

export function createMockQuizMoments(): QuizMoment[] {
  return fallbackQuizMoments;
}
