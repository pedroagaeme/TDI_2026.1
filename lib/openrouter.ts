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
    '3. DENSITY: Aim for ~5 moments per 6 minutes. Minimum 15s between moments. Start preference > 30s.',
    '4. VERIFICATION: Ensure the "correct_option" is grounded in the cues immediately following the timestamp.',
    '5. TIMESTAMPING: Use the onset of the event, not a reaction shot or aftermath. The chosen timestamp must be at most 10 seconds earlier than the first visible/audio cue for that event.',
    '6. OMIT LATE MOMENTS: If the clearest event beat is only visible more than 10 seconds later, skip that moment.',
    '7. SANITY CHECK: Before selecting a moment, verify that the event actually happens on screen and that both answer options still make sense when compared against the transcript, visual summary, and nearby cues. Skip moments that are ambiguous, speculative, or only reaction shots.',
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
    'Timestamp rule: the timestamp must point to the start of the event and remain within 10 seconds of the actual event onset.',
    'Verification rule: verify whether the timestamp matches what is actually happening at that time. If it does not, search second by second for the real timestamp. If you still cannot find it, reject the moment and try another one.',
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
  // If the model returns an empty array (no moments passed verification), return it gracefully.
  if (Array.isArray(parsed) && parsed.length === 0) {
    return [];
  }
  return quizMomentsSchema.parse(parsed);
}

function pruneGoogleAnnotations(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const a = raw as Record<string, any>;

  const filterByConfidence = <T extends { confidence?: number }>(arr: T[] | undefined, threshold = 0.7) =>
    arr?.filter((x) => (x.confidence ?? 1) >= threshold) ?? [];

  const speechTranscriptions = (a.speechTranscriptions as any[])?.map((t: any) => ({
    alternatives: t.alternatives?.slice(0, 1).map((alt: any) => ({
      transcript: alt.transcript,
      confidence: alt.confidence
    }))
  }));

  const segmentLabelAnnotations = filterByConfidence(a.segmentLabelAnnotations as any[], 0.75).map((l: any) => ({
    entity: l.entity,
    segments: l.segments?.slice(0, 3)
  }));

  const shotAnnotations = (a.shotAnnotations as any[])?.map((s: any) => ({
    startTimeOffset: s.startTimeOffset,
    endTimeOffset: s.endTimeOffset
  }));

  const objectAnnotations = filterByConfidence(a.objectAnnotations as any[], 0.8).map((o: any) => ({
    entity: o.entity,
    confidence: o.confidence,
    segment: o.segment
  }));

  const explicitAnnotation = {
    frames:
      (a.explicitAnnotation as any)?.frames?.filter(
        (f: any) => f.pornographyLikelihood !== 'VERY_UNLIKELY' && f.pornographyLikelihood !== 'UNLIKELY'
      ) ?? []
  };

  return {
    speechTranscriptions,
    segmentLabelAnnotations,
    shotAnnotations,
    objectAnnotations,
    explicitAnnotation
  };
}

function estimateTokens(text: string) {
  return Math.ceil(text.length / 4);
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
  googleAnnotations?: unknown
): Promise<OpenRouterQuizGenerationResult> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is required in strict API mode.');
  }

  const model = process.env.OPENROUTER_MODEL?.trim();
  if (!model) {
    throw new Error('OPENROUTER_MODEL is required in strict API mode.');
  }

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
      const pruned = pruneGoogleAnnotations(googleAnnotations);
      messages.push({
        role: 'user',
        content: `GOOGLE_VIDEO_INTELLIGENCE_ANNOTATIONS:\n${JSON.stringify(pruned)}`
      });
    } catch (e) {
      messages.push({ role: 'user', content: 'GOOGLE_VIDEO_INTELLIGENCE_ANNOTATIONS: <unserializable>' });
    }
  }

  let body: any = {
    model,
    messages,
    temperature: 0.0,
    reasoning: {
      enabled: true
    },
    verbosity: 'max'
  };

  // Pre-flight token estimation to avoid sending payloads that exceed limits.
  const bodyString = JSON.stringify(body);
  const estimatedTokens = estimateTokens(bodyString);
  const TOKEN_LIMIT = parseInt(process.env.OPENROUTER_TOKEN_LIMIT || '900000', 10);
  if (estimatedTokens > TOKEN_LIMIT) {
    // If configured, let OpenRouter attempt context compression as a last resort.
    if (process.env.OPENROUTER_USE_COMPRESSION === '1') {
      body.plugins = [{ id: 'context-compression' }];
    } else {
      throw new Error(
        `Payload too large: ~${estimatedTokens.toLocaleString()} estimated tokens (limit ${TOKEN_LIMIT.toLocaleString()}). ` +
          `Prune googleAnnotations before sending or enable OPENROUTER_USE_COMPRESSION.`
      );
    }
  }

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
