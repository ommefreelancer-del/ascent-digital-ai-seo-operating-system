// Append-only, newline-delimited JSON writer. Used for logs that only ever
// grow (like the audit trail) where each entry is independent, so a simple
// append is both simpler and safer than rewriting a whole JSON array on
// every write.
//
// Size-based rotation keeps a single log file from growing unbounded in
// long-running production use: once the active file reaches `maxBytes`,
// it is renamed to a numbered backup (`<file>.1`, shifting any older
// backups up to `<file>.2`, `<file>.3`, ...) and a fresh file is started
// on the next append. Rotation is on by default with a generous size
// (10 MB) and a small backup count (3) -- existing callers that construct
// `new JsonlAppender(filePath)` with no options see no behavior change
// until a log actually reaches that size.

import { appendFile, mkdir, rename, stat, unlink } from "node:fs/promises";
import { dirname } from "node:path";

export interface JsonlAppenderOptions {
  /** Rotate once the active file reaches this size, in bytes. Set to `0` to disable rotation. Default: 10 MB. */
  readonly maxBytes?: number;
  /** How many rotated backups (`<file>.1` .. `<file>.N`) to retain before the oldest is deleted. Default: 3. */
  readonly maxBackups?: number;
}

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_BACKUPS = 3;

export class JsonlAppender {
  private readonly filePath: string;
  private readonly maxBytes: number;
  private readonly maxBackups: number;
  private initialized = false;

  constructor(filePath: string, options: JsonlAppenderOptions = {}) {
    this.filePath = filePath;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.maxBackups = options.maxBackups ?? DEFAULT_MAX_BACKUPS;
  }

  /** Appends one JSON-serializable record as a single line. */
  async append(record: unknown): Promise<void> {
    if (!this.initialized) {
      await mkdir(dirname(this.filePath), { recursive: true });
      this.initialized = true;
    }
    await this.rotateIfNeeded();
    await appendFile(this.filePath, `${JSON.stringify(record)}\n`, "utf8");
  }

  /** Renames the active file down the backup chain once it has grown past `maxBytes`. A no-op otherwise. */
  private async rotateIfNeeded(): Promise<void> {
    if (this.maxBytes <= 0 || this.maxBackups <= 0) {
      return;
    }
    const size = await this.currentFileSize();
    if (size === null || size < this.maxBytes) {
      return;
    }

    for (let index = this.maxBackups; index >= 1; index -= 1) {
      const source = index === 1 ? this.filePath : `${this.filePath}.${index - 1}`;
      const destination = `${this.filePath}.${index}`;
      if (index === this.maxBackups) {
        await unlink(destination).catch(() => undefined);
      }
      await rename(source, destination).catch(() => undefined);
    }
  }

  private async currentFileSize(): Promise<number | null> {
    try {
      const info = await stat(this.filePath);
      return info.size;
    } catch (error) {
      if (isNodeErrnoException(error) && error.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }
}

function isNodeErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
