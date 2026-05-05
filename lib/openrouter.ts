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
    '### TAREFA',
    'Atue como um mecanismo de raciocínio multimodal. Analise os metadados do vídeo fornecidos (Transcrição + Resumo Visual + Pistas) para identificar "Momentos de Previsão Divisiva" de alta tensão.',
    '',
    '### ESTRATÉGIA DE SELEÇÃO (CRÍTICO)',
    '1. CORRELACIONAR: Correlacione a transcrição com as pistas visuais. Procure momentos em que o áudio gera tensão e o resultado visual não é óbvio.',
    '2. DIVISIVIDADE: Um momento é "divisivo" se um espectador pudesse razoavelmente argumentar por duas saídas imediatas. Evite "silêncio" ou continuidade óbvia.',
    '3. DENSIDADE: Mire em ~5 momentos por 6 minutos. Mínimo de 15s entre momentos. Preferência para início > 30s.',
    '4. VERIFICAÇÃO: Garanta que a `correct_option` esteja fundamentada nas pistas imediatamente após o timestamp.',
    '5. MARCAÇÃO DE TEMPO: Use o início do evento, não uma tomada de reação ou consequência. O timestamp escolhido deve ser, no máximo, 10 segundos anterior à primeira pista visível/áudio desse evento.',
    '6. OMITIR MOMENTOS TARDIOS: Se o pulso de evento mais claro só for visível mais de 10 segundos depois, pule esse momento.',
    '7. CHECAGEM DE SANIDADE: Antes de selecionar um momento, verifique se o evento realmente acontece na tela e se ambas as opções fazem sentido quando comparadas à transcrição, ao resumo visual e às pistas próximas. Pule momentos ambíguos, especulativos ou apenas de reação.',
    '',
    '### DADOS A ANALISAR',
    `Transcrição:\n${analysis.transcript || '(nenhuma)'}`,
    '',
    `Resumo Visual:\n${analysis.visualSummary}`,
    '',
    `Linha do Tempo:\n${cuesBlock || '(nenhuma)'}`,
    '',
    `Constraints: ${durationLine}`,
    '',
    '### FORMATO DE SAÍDA',
    'Retorne APENAS um array JSON válido. Sem texto de conversação. Sem blocos de código.',
    'Estrutura: {"timestamp": number, "correct_option_text": string, "wrong_option_text": string}',
    'Regra de timestamp: o timestamp deve apontar para o início do evento e permanecer dentro de 10 segundos do início real do evento.',
    'Regra de verificação: verifique se o timestamp corresponde ao que realmente acontece naquele momento. Se não corresponder, busque segundo a segundo pelo timestamp real. Se ainda não encontrar, rejeite o momento e tente outro.',
    '',
    '### DIRETRIZES DE OPÇÕES',
    '- Ambas as opções devem ser orientadas para o futuro ("Em seguida, o motorista..." / "Imediatamente, a mulher...").',
    '- A "wrong_option" deve ser uma Alternativa Crível: ela deve espelhar o tom, a complexidade e o vocabulário do evento correto.',
    '- Se o evento real for uma surpresa, o evento falso também deve ser uma surpresa plausível.'
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
      content: `Você é um gerador preciso de JSON para um quiz de previsão de vídeo sobre o arquivo "${videoName}". Siga as instruções do usuário exatamente e retorne apenas arrays JSON válidos. Responda em Português (pt-BR).`
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
