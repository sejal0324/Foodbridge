import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { badRequest } from '../utils/errors.js';

export type AllowedMime = 'application/pdf' | 'image/jpeg' | 'image/png';

const EXTENSION: Record<AllowedMime, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

/** Detects the real file type from magic bytes; the client-declared type is never trusted. */
export function detectMime(buffer: Buffer): AllowedMime | undefined {
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  return undefined;
}

export function sanitizeFilename(name: string): string {
  const base = path.basename(name).replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 200);
  return base || 'upload';
}

/**
 * Private file storage on the local filesystem (outside any web root). Files
 * are only ever served through authorised API endpoints. Swap for object
 * storage (S3-compatible) in production by implementing the same methods.
 */
export class LocalFileStorage {
  constructor(private readonly root: string) {}

  async save(folder: 'documents' | 'representatives', buffer: Buffer, mime: AllowedMime): Promise<string> {
    const key = `${folder}/${randomUUID()}.${EXTENSION[mime]}`;
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, buffer, { mode: 0o600 });
    return key;
  }

  async read(key: string): Promise<Buffer> {
    return readFile(this.resolve(key));
  }

  private resolve(key: string): string {
    if (!/^(documents|representatives)\/[0-9a-f-]{36}\.(pdf|jpg|png)$/.test(key)) throw badRequest('Invalid storage key.');
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw badRequest('Invalid storage key.');
    return full;
  }
}
