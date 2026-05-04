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
    '### TASK',
    'Act as a Multimodal Reasoning Engine. Analyze the provided video metadata (Transcript + Visual Summary + Cues) to identify high-tension "Divisive Prediction Moments".',
    '',
    '### SELECTION STRATEGY (CRITICAL)',
    '1. CORRELATE: Cross-reference the transcript sentiment with visual cues. Look for moments where the audio builds tension but the visual outcome is non-obvious.',
    '2. DIVISIVENESS: A moment is "divisive" if a viewer could reasonably argue for two different immediate outcomes. Avoid "dead-air" or obvious continuity.',
    '3. DENSITY: Aim for ~5 moments per 6 minutes. Minimum 45s between moments. Start preference > 30s.',
    '4. VERIFICATION: Ensure the "correct_option" is grounded in the cues immediately following the timestamp.',
    '',
    '### DATA TO ANALYZE',
    `Transcript:\n${analysis.transcript || '(none)'}`,
    '',
    `Visual Summary:\n${analysis.visualSummary}`,
    '',
    `Timeline Cues:\n${cuesBlock || '(none)'}`,
    '',
    `Constraints: ${durationLine}`,
    '',
    '### OUTPUT FORMAT',
    'Return ONLY a valid JSON array. No conversational text. No code fences.',
    'Structure: {"timestamp": number, "correct_option_text": string, "wrong_option_text": string}',
    '',
    '### OPTION GUIDELINES',
    '- Both options must be forward-looking ("Next, the driver..." / "Immediately, the woman...").',
    '- The "wrong_option" must be a "Believable Alternative": it should mirror the tone, complexity, and vocabulary of the correct event.',
    '- If the real event is a surprise, the fake event must also be a plausible surprise.'
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
  videoName: string,
  videoBuffer?: Buffer,
  googleAnnotations?: unknown
): Promise<OpenRouterQuizGenerationResult> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is required in strict API mode.');
  }

  const model = 'google/gemini-3.1-pro-preview';
  const messages: Array<{ role: string; content: string }> = [
    {
      role: 'system',
      content: `You are a precise JSON generator for a video prediction quiz about the file "${videoName}". You follow user instructions exactly and output only valid JSON arrays.`
    },
    {
      role: 'user',
      content: buildPrompt(analysis)
    }
  ];

  if (googleAnnotations) {
    try {
      messages.push({
        role: 'user',
        content: `GOOGLE_VIDEO_INTELLIGENCE_ANNOTATIONS:\n${JSON.stringify(googleAnnotations, null, 2)}`
      });
    } catch (e) {
      messages.push({ role: 'user', content: 'GOOGLE_VIDEO_INTELLIGENCE_ANNOTATIONS: <unserializable>' });
    }
  }

  if (videoBuffer && videoBuffer.length > 0) {
    const maxBytes = 200_000; // truncate large videos to avoid excessively large requests
    const prefix = videoBuffer.slice(0, maxBytes).toString('base64');
    messages.push({
      role: 'user',
      content: `VIDEO_ATTACHMENT_METADATA:\nsize_bytes: ${videoBuffer.length}\nbase64_prefix_truncated_to_bytes: ${Math.min(maxBytes, videoBuffer.length)}\nbase64_prefix: ${prefix}`
    });
  }

  const body = {
    model,
    messages,
    temperature: 0.0
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
