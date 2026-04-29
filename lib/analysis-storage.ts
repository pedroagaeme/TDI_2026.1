import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type { StoredAnalysisManifest } from '@/TDI_2026.1/lib/types';

const STORAGE_ROOT = process.env.VIDEO_ANALYSIS_STORAGE_DIR?.trim() || join(process.cwd(), 'storage', 'accounts');

function sanitizeFileName(fileName: string) {
  const cleaned = fileName.replace(/[^a-z0-9._-]/gi, '_').replace(/_+/g, '_');
  return cleaned || 'video';
}

export function sanitizeAccountId(accountId: string) {
  const normalized = accountId.trim().toLowerCase().replace(/[^a-z0-9._-]/gi, '_').replace(/_+/g, '_');
  return normalized;
}

function sanitizeExtension(fileName: string) {
  const extension = extname(fileName).trim();
  return extension || '.mp4';
}

export interface AnalysisStorageRecord {
  analysisId: string;
  accountId: string;
  accountDirectory: string;
  storageDirectory: string;
  videoPath: string;
  googleAnnotationPath: string;
  openRouterResponsePath: string;
  manifestPath: string;
}

export function getAccountDirectory(accountId: string) {
  return join(STORAGE_ROOT, sanitizeAccountId(accountId));
}

export function getAnalysisDirectory(accountId: string, analysisId: string) {
  return join(getAccountDirectory(accountId), analysisId);
}

export function getManifestPath(accountId: string, analysisId: string) {
  return join(getAnalysisDirectory(accountId, analysisId), 'analysis-manifest.json');
}

export async function createAnalysisStorageRecord(fileName: string, accountId: string): Promise<AnalysisStorageRecord> {
  const normalizedAccountId = sanitizeAccountId(accountId);
  if (!normalizedAccountId) {
    throw new Error('Account ID is required.');
  }

  const analysisId = randomUUID();
  const accountDirectory = join(STORAGE_ROOT, normalizedAccountId);
  const storageDirectory = join(accountDirectory, analysisId);
  await mkdir(storageDirectory, { recursive: true });

  const safeName = sanitizeFileName(fileName);
  const extension = sanitizeExtension(fileName);

  return {
    analysisId,
    accountId: normalizedAccountId,
    accountDirectory,
    storageDirectory,
    videoPath: join(storageDirectory, `video-${safeName}${extension}`),
    googleAnnotationPath: join(storageDirectory, 'google-annotations.json'),
    openRouterResponsePath: join(storageDirectory, 'openrouter-response.json'),
    manifestPath: join(storageDirectory, 'analysis-manifest.json')
  };
}

export async function readManifest(accountId: string, analysisId: string): Promise<StoredAnalysisManifest> {
  const manifestText = await readFile(getManifestPath(accountId, analysisId), 'utf8');
  return JSON.parse(manifestText) as StoredAnalysisManifest;
}

export async function listManifestsForAccount(accountId: string): Promise<StoredAnalysisManifest[]> {
  const accountDirectory = getAccountDirectory(accountId);

  const entries = await readdir(accountDirectory, { withFileTypes: true }).catch(() => []);
  const analysisIds = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);

  const manifests = await Promise.all(
    analysisIds.map(async (analysisId) => {
      try {
        return await readManifest(accountId, analysisId);
      } catch {
        return null;
      }
    })
  );

  return manifests
    .filter((manifest): manifest is StoredAnalysisManifest => Boolean(manifest))
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}