import { GoogleAuth } from 'google-auth-library';
import { readFile } from 'node:fs/promises';
import type { AnalysisCue, NormalizedVideoAnalysis } from '@/lib/types';

const GOOGLE_API_ROOT = 'https://videointelligence.googleapis.com/v1';

function logGoogleVideoIntelligence(message: string, details?: Record<string, unknown>) {
  if (details) {
    console.log(`[google-video-intelligence] ${message}`, details);
    return;
  }

  console.log(`[google-video-intelligence] ${message}`);
}

type GoogleTiming = {
  seconds?: string | number;
  nanos?: number;
};

type GoogleWord = {
  word?: string;
  startTime?: GoogleTiming;
  endTime?: GoogleTiming;
};

type GoogleSegment = {
  startTimeOffset?: GoogleTiming;
  endTimeOffset?: GoogleTiming;
};

function toSeconds(value?: GoogleTiming): number | undefined {
  if (!value) {
    return undefined;
  }

  const seconds = typeof value.seconds === 'string' ? Number(value.seconds) : value.seconds ?? 0;
  const nanos = value.nanos ?? 0;
  if (!Number.isFinite(seconds)) {
    return undefined;
  }

  return seconds + nanos / 1_000_000_000;
}

function extractCredentials() {
  const raw = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON?.trim();
  if (!raw) {
    return undefined;
  }

  const normalized =
    (raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"'))
      ? raw.slice(1, -1)
      : raw;

  const parseCandidate = (candidate: string) => {
    const parsed = JSON.parse(candidate) as Record<string, unknown>;
    const privateKey = parsed.private_key;
    if (typeof privateKey === 'string') {
      parsed.private_key = privateKey.replace(/\\n/g, '\n');
    }
    return parsed;
  };

  try {
    return parseCandidate(normalized);
  } catch {
    try {
      const decoded = Buffer.from(normalized, 'base64').toString('utf8');
      return parseCandidate(decoded);
    } catch {
      throw new Error(
        'GOOGLE_APPLICATION_CREDENTIALS_JSON is invalid. Provide raw service-account JSON (single line) or base64-encoded JSON.'
      );
    }
  }
}

async function getAccessToken() {
  logGoogleVideoIntelligence('Starting Google auth client setup.');

  const auth = new GoogleAuth({
    credentials: extractCredentials(),
    scopes: ['https://www.googleapis.com/auth/cloud-platform']
  });
  const client = await auth.getClient();
  logGoogleVideoIntelligence('Google auth client resolved. Requesting access token.');

  const tokenResponse = await client.getAccessToken();
  const accessToken = typeof tokenResponse === 'string' ? tokenResponse : tokenResponse?.token;

  if (!accessToken) {
    throw new Error('Google auth did not return an access token.');
  }

  logGoogleVideoIntelligence('Google access token acquired successfully.');

  return accessToken;
}

function buildGoogleHeaders(accessToken: string) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`
  };

  if (process.env.GOOGLE_PROJECT_ID?.trim()) {
    headers['x-goog-user-project'] = process.env.GOOGLE_PROJECT_ID.trim();
  }

  return headers;
}

function buildAnalysisCue(timestamp: number, source: AnalysisCue['source'], description: string): AnalysisCue {
  return {
    timestamp: Number(timestamp.toFixed(2)),
    source,
    description
  };
}

const GOOGLE_POLL_MAX_ATTEMPTS = Number(process.env.GOOGLE_VIDEO_POLL_MAX_ATTEMPTS || 720);
const GOOGLE_POLL_DELAY_MS = Number(process.env.GOOGLE_VIDEO_POLL_DELAY_MS || 5000);

function normalizeGoogleResponse(response: any, fileName: string): NormalizedVideoAnalysis {
  const annotation = response?.annotationResults?.[0] ?? {};
  const cues: AnalysisCue[] = [];
  const transcriptParts: string[] = [];

  for (const transcription of annotation.speechTranscriptions ?? []) {
    for (const alternative of transcription.alternatives ?? []) {
      if (typeof alternative?.transcript === 'string' && alternative.transcript.trim()) {
        transcriptParts.push(alternative.transcript.trim());
      }

      for (const word of (alternative?.words ?? []) as GoogleWord[]) {
        const wordTimestamp = toSeconds(word.startTime);
        if (typeof wordTimestamp === 'number' && typeof word.word === 'string' && word.word.trim()) {
          cues.push(buildAnalysisCue(wordTimestamp, 'speech', `Word spoken: ${word.word.trim()}`));
        }
      }
    }
  }

  for (const textAnnotation of annotation.textAnnotations ?? []) {
    const label = typeof textAnnotation?.text === 'string' ? textAnnotation.text.trim() : '';
    for (const segment of (textAnnotation?.segments ?? []) as GoogleSegment[]) {
      const timestamp = toSeconds(segment.startTimeOffset) ?? toSeconds(segment.endTimeOffset);
      if (typeof timestamp === 'number' && label) {
        cues.push(buildAnalysisCue(timestamp, 'text', `On-screen text detected: ${label}`));
      }
    }
  }

  for (const label of annotation.segmentLabelAnnotations ?? []) {
    const description = typeof label?.entity?.description === 'string' ? label.entity.description.trim() : '';
    for (const segment of label?.segments ?? []) {
      const timestamp = toSeconds(segment?.segment?.startTimeOffset) ?? toSeconds(segment?.segment?.endTimeOffset);
      if (typeof timestamp === 'number' && description) {
        cues.push(buildAnalysisCue(timestamp, 'label', `Visual context: ${description}`));
      }
    }
  }

  for (const shot of annotation.shotAnnotations ?? []) {
    const timestamp = toSeconds(shot?.startTimeOffset) ?? 0;
    cues.push(buildAnalysisCue(timestamp, 'scene', 'Shot boundary or scene change detected.'));
  }

  const transcript = transcriptParts.length
    ? transcriptParts.join(' ')
    : `No speech transcript was extracted for ${fileName}.`;

  const visualSummary = cues.length
    ? cues
        .slice(0, 20)
        .map((cue) => `${cue.timestamp.toFixed(2)}s [${cue.source}] ${cue.description}`)
        .join('\n')
    : `No notable visual cues were returned for ${fileName}.`;

  logGoogleVideoIntelligence('Google response normalized.', {
    fileName,
    transcriptParts: transcriptParts.length,
    cueCount: cues.length,
    transcriptLength: transcript.length,
    visualSummaryLines: visualSummary.split('\n').length
  });

  return {
    transcript,
    visualSummary,
    cues,
    sourceLabel: 'google'
  };
}

async function pollOperation(accessToken: string, operationName: string) {
  const operationUrl = `${GOOGLE_API_ROOT}/${operationName}`;

  logGoogleVideoIntelligence('Polling Google Video Intelligence operation.', {
    operationName,
    operationUrl
  });

  for (let attempt = 0; attempt < GOOGLE_POLL_MAX_ATTEMPTS; attempt += 1) {
    logGoogleVideoIntelligence('Polling attempt started.', {
      operationName,
      attempt: attempt + 1
    });

    const response = await fetch(operationUrl, {
      headers: buildGoogleHeaders(accessToken),
      cache: 'no-store'
    });

    if (!response.ok) {
      const responseText = await response.text().catch(() => 'Unable to read Google error body.');
      logGoogleVideoIntelligence('Polling attempt failed.', {
        operationName,
        attempt: attempt + 1,
        status: response.status,
        responsePreview: responseText.slice(0, 200)
      });
      throw new Error(`Google operation polling failed with ${response.status}: ${responseText.slice(0, 500)}`);
    }

    const payload = await response.json();
    logGoogleVideoIntelligence('Polling attempt completed.', {
      operationName,
      attempt: attempt + 1,
      done: Boolean(payload.done),
      hasError: Boolean(payload.error)
    });

    if (payload.done) {
      if (payload.error) {
        throw new Error(payload.error.message || 'Google Video Intelligence returned an error.');
      }

      logGoogleVideoIntelligence('Google Video Intelligence operation finished successfully.', {
        operationName,
        attempt: attempt + 1
      });

      return payload.response;
    }

    await new Promise((resolve) => setTimeout(resolve, GOOGLE_POLL_DELAY_MS));
  }

  throw new Error('Google Video Intelligence operation timed out.');
}

export async function analyzeVideoWithGoogle(
  filePath: string,
  fileName: string
): Promise<NormalizedVideoAnalysis & { rawGoogleResponse: unknown }> {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
    throw new Error('GOOGLE_APPLICATION_CREDENTIALS_JSON is required in strict API mode.');
  }

  const startedAt = Date.now();
  logGoogleVideoIntelligence('Video analysis started.', {
    fileName,
    filePath,
    languageCode: process.env.GOOGLE_VIDEO_LANGUAGE || 'en-US'
  });

  try {
    const accessToken = await getAccessToken();
    const videoBytes = await readFile(filePath);
    logGoogleVideoIntelligence('Video file loaded from disk.', {
      fileName,
      fileSizeBytes: videoBytes.length,
      fileSizeMb: Number((videoBytes.length / 1024 / 1024).toFixed(2))
    });

    const requestBody = {
      inputContent: videoBytes.toString('base64'),
      features: ['SPEECH_TRANSCRIPTION', 'TEXT_DETECTION', 'LABEL_DETECTION', 'SHOT_CHANGE_DETECTION'],
      videoContext: {
        speechTranscriptionConfig: {
          languageCode: process.env.GOOGLE_VIDEO_LANGUAGE || 'en-US',
          enableAutomaticPunctuation: true
        },
        textDetectionConfig: {
          model: 'builtin/latest'
        }
      }
    };

    logGoogleVideoIntelligence('Submitting Google Video Intelligence request.', {
      fileName,
      features: requestBody.features,
      hasProjectId: Boolean(process.env.GOOGLE_PROJECT_ID?.trim())
    });

    const createResponse = await fetch(`${GOOGLE_API_ROOT}/videos:annotate`, {
      method: 'POST',
      headers: {
        ...buildGoogleHeaders(accessToken),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    logGoogleVideoIntelligence('Google Video Intelligence create request completed.', {
      fileName,
      status: createResponse.status,
      ok: createResponse.ok
    });

    if (!createResponse.ok) {
      const responseText = await createResponse.text().catch(() => 'Unable to read Google error body.');
      logGoogleVideoIntelligence('Google Video Intelligence rejected the request.', {
        fileName,
        status: createResponse.status,
        responsePreview: responseText.slice(0, 200)
      });
      throw new Error(`Google Video Intelligence rejected the request with ${createResponse.status}: ${responseText.slice(0, 500)}`);
    }

    const operation = await createResponse.json();
    logGoogleVideoIntelligence('Google operation created.', {
      fileName,
      operationName: operation?.name
    });

    const rawGoogleResponse = await pollOperation(accessToken, operation.name);
    const normalized = normalizeGoogleResponse(rawGoogleResponse, fileName);
    logGoogleVideoIntelligence('Video analysis completed.', {
      fileName,
      durationMs: Date.now() - startedAt,
      cueCount: normalized.cues.length,
      sourceLabel: normalized.sourceLabel
    });
    return {
      ...normalized,
      rawGoogleResponse
    };
  } catch (error) {
    logGoogleVideoIntelligence('Video analysis failed.', {
      fileName,
      durationMs: Date.now() - startedAt,
      errorMessage: (error as Error).message
    });
    throw new Error(`Google Video Intelligence failed: ${(error as Error).message}`);
  }
}
