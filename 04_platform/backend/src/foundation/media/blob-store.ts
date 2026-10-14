import { Logger } from '@nestjs/common';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';

/**
 * BlobStore — the byte-storage seam. The core NEVER holds image bytes: it keeps a MediaRef (metadata)
 * and the bytes live behind this interface. The sandbox impl is the filesystem; a prod S3/GCS/R2 impl
 * (presigned PUT) slots in without moving a single caller. Bytes only — content-type, size, retention
 * and ownership all live on the MediaRef, so this stays a dumb key→bytes store.
 */
export interface BlobStore {
  put(key: string, bytes: Buffer): void;
  get(key: string): Buffer | undefined;
  delete(key: string): void;
  has(key: string): boolean;
}

/** Snapshot/media root — the same gitignored `data/` tree the PersistentMap snapshots live under. */
const DATA_DIR = process.env.GLOS_DATA_DIR || join(process.cwd(), 'data');
const MEDIA_DIR = process.env.GLOS_MEDIA_DIR || join(DATA_DIR, 'media');

/**
 * On by default; off when GLOS_PERSIST=off, and ALWAYS off under Jest (mirrors PersistentMap). A blob
 * store that wrote files during tests would leak bytes between runs, so it falls back to an in-memory
 * map — the MediaService is exercised end to end in tests without ever touching disk.
 */
function persistenceEnabled(): boolean {
  return (process.env.GLOS_PERSIST ?? 'on').toLowerCase() !== 'off' && process.env.JEST_WORKER_ID === undefined;
}

/**
 * Filesystem blob store — one file per key under a gitignored media dir (`data/` is ignored, and the
 * blobs are PII: faces/addresses/IDs, so they must never enter git). In-memory when persistence is off.
 */
export class FsBlobStore implements BlobStore {
  private readonly logger = new Logger(FsBlobStore.name);
  private readonly persist = persistenceEnabled();
  private readonly mem = new Map<string, Buffer>();
  private readonly dir: string;

  constructor(dir: string = MEDIA_DIR) {
    this.dir = dir;
    if (this.persist) mkdirSync(this.dir, { recursive: true });
  }

  /** Keys are opaque hex ids we generate, but sanitise anyway so a key can never escape the media dir. */
  private path(key: string): string {
    return join(this.dir, key.replace(/[^a-zA-Z0-9._-]/g, '_'));
  }

  put(key: string, bytes: Buffer): void {
    if (!this.persist) {
      this.mem.set(key, bytes);
      return;
    }
    const file = this.path(key);
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, bytes);
    renameSync(tmp, file); // atomic on a single filesystem — never a half-written blob
  }

  get(key: string): Buffer | undefined {
    if (!this.persist) return this.mem.get(key);
    const file = this.path(key);
    if (!existsSync(file)) return undefined;
    try {
      return readFileSync(file);
    } catch (err) {
      this.logger.error(`Could not read blob ${key}: ${(err as Error).message}`);
      return undefined;
    }
  }

  delete(key: string): void {
    if (!this.persist) {
      this.mem.delete(key);
      return;
    }
    const file = this.path(key);
    try {
      if (existsSync(file)) unlinkSync(file);
    } catch (err) {
      this.logger.error(`Could not delete blob ${key}: ${(err as Error).message}`);
    }
  }

  has(key: string): boolean {
    if (!this.persist) return this.mem.has(key);
    return existsSync(this.path(key));
  }
}
