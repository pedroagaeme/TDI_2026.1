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
  const durationLine =
    typeof analysis.durationSeconds === 'number' && Number.isFinite(analysis.durationSeconds)
      ? `Approximate video duration: ${analysis.durationSeconds.toFixed(2)} seconds. Only use timestamps within [0, duration].`
      : 'Infer sensible timestamps in seconds from the cues below.';

  const cuesBlock = analysis.cues
    .map((cue) => `${cue.timestamp.toFixed(2)}s | ${cue.source} | ${cue.description}`)
    .join('\n');

  return [
    'You are generating prediction moments for a video quiz. You receive the full timeline as cues (every timestamp the analysis extracted) plus transcript and visual summary.',
    '',
    'Return ONLY valid JSON: an array of objects, each exactly:',
    '{"timestamp": number, "correct_option_text": string, "wrong_option_text": string}',
    'No markdown, no code fences, no extra keys, no trailing commentary.',
    '',
    'Selection strategy:',
    '- Review EVERY cue timestamp and the overall video context (transcript + visual summary + all cues).',
    '- Keep only the MOST IMPORTANT moments for a quiz: where what happens next is genuinely hard to predict (branching, surprise, ambiguity, or a sharp turn—not obvious continuity).',
    '- Skip redundant or low-stakes beats where the next action is obvious.',
    '- Do not place moments in the first ~30 seconds unless absolutely unavoidable; preferred first timestamp is >= 30s.',
    '- Keep spacing between selected moments so they are not clustered; aim for at least ~45 seconds between timestamps whenever possible.',
    '- Target density: about 5 moments per 6 minutes of video (scale proportionally by duration, rounded to a sensible integer).',
    '- Sort the final array by timestamp ascending.',
    '- Each timestamp must match a meaningful beat (typically aligned to or just before a cue you rely on).',
    durationLine,
    '',
    'How to write each pair of options (critical):',
    '- Describe ONLY what happens IMMEDIATELY after the pause point—roughly the next beat or second or two of action, not the whole scene.',
    '- Do NOT refer to events that already happened before the pause (no "after they already…", "having just…").',
    '- Do NOT refer to things that happen much later or at the end of the video.',
    '- Phrase both options as forward-looking predictions: "Next, …" / "Right away, …" style, same tense and length.',
    '- correct_option_text = what actually happens next in the video (per transcript/cues/summary).',
    '- wrong_option_text = a different immediate outcome that did NOT happen.',
    '- Matched believability: if the true next beat is ordinary and believable, the wrong option must be equally ordinary and believable (not cartoonish). If the true next beat is surprising or "out of the box", the wrong option must feel equally surprising or unconventional—not a boring filler.',
    '- Do not make the wrong option absurd or sarcastic unless the correct one is equally extreme.',
    '- Keep each option one or two short sentences, concrete and visual.',
    '',
    `Transcript:\n${analysis.transcript || '(none)'}`,
    '',
    `Visual summary:\n${analysis.visualSummary}`,
    '',
    `Cues (full timeline — use all when choosing moments and wording):\n${cuesBlock || '(none)'}`
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
        content: `You are a precise JSON generator for a video prediction quiz about the file "${videoName}". You follow user instructions exactly and output only valid JSON arrays.`
      },
      {
        role: 'user',
        content: buildPrompt(analysis)
      }
    ],
    temperature: 0.4
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
