import { z } from 'zod';
import type { NormalizedVideoAnalysis, QuizMoment } from '@/lib/types';
import { quizMomentsSchema } from '@/lib/types';

const openRouterSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().default('')
        })
      })
    )
    .min(1)
});

function stripCodeFences(value: string) {
  const match = value.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return match ? match[1].trim() : value.trim();
}

function buildPrompt(analysis: NormalizedVideoAnalysis) {
  return [
    'You are generating prediction moments for a video quiz.',
    'Return ONLY valid JSON with the shape [{"timestamp":number,"correct_option_text":string,"wrong_option_text":string}].',
    'Rules:',
    '- Use timestamps in seconds.',
    '- Sort items by timestamp ascending.',
    '- Choose moments where a viewer could reasonably predict what happens next.',
    '- Keep each option concise and visually grounded.',
    '- Make the wrong option plausible, not absurd.',
    '- Do not include extra keys or markdown.',
    '',
    `Transcript: ${analysis.transcript}`,
    '',
    `Visual summary:\n${analysis.visualSummary}`,
    '',
    `Cues:\n${analysis.cues
      .map((cue) => `${cue.timestamp.toFixed(2)}s | ${cue.source} | ${cue.description}`)
      .join('\n')}`
  ].join('\n');
}

function parseMoments(rawContent: string): QuizMoment[] {
  const cleaned = stripCodeFences(rawContent);
  const parsed = JSON.parse(cleaned) as unknown;
  return quizMomentsSchema.parse(parsed);
}

export interface OpenRouterQuizGenerationResult {
  quizMoments: QuizMoment[];
  rawContent: string;
  rawResponse: unknown;
  model: string;
}

export async function generateQuizMomentsFromOpenRouter(
  analysis: NormalizedVideoAnalysis,
  videoName: string
): Promise<OpenRouterQuizGenerationResult> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is required in strict API mode.');
  }

  const model = process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';
  const body = {
    model,
    messages: [
      {
        role: 'system',
        content: `You are a precise JSON generator for a ${videoName} video prediction game.`
      },
      {
        role: 'user',
        content: buildPrompt(analysis)
      }
    ],
    temperature: 0.3
  };

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.OPENROUTER_APP_URL || 'http://localhost:3000',
      'X-Title': process.env.OPENROUTER_APP_NAME || 'Video Prediction Quiz'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const responseText = await response.text().catch(() => 'Unable to read OpenRouter error body.');
    throw new Error(`OpenRouter request failed with ${response.status}: ${responseText.slice(0, 500)}`);
  }

  const rawResponse = await response.json();
  const payload = openRouterSchema.parse(rawResponse);
  const content = payload.choices[0]?.message?.content ?? '';

  try {
    return {
      quizMoments: parseMoments(content),
      rawContent: content,
      rawResponse,
      model
    };
  } catch (error) {
    throw new Error(`OpenRouter returned invalid quiz JSON: ${(error as Error).message}`);
  }
}
