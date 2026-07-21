// Append-only, newline-delimited JSON writer. Used for logs that only ever
// grow (like the audit trail) where each entry is independent, so a simple
// append is both simpler and safer than rewriting a whole JSON array on
// every write.

import { mkdir, appendFile } from "node:fs/promises";
import { dirname } from "node:path";

export class JsonlAppender {
  private readonly filePath: string;
  private initialized = false;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  /** Appends one JSON-serializable record as a single line. */
  async append(record: unknown): Promise<void> {
    if (!this.initialized) {
      await mkdir(dirname(this.filePath), { recursive: true });
      this.initialized = true;
    }
    await appendFile(this.filePath, `${JSON.stringify(record)}\n`, "utf8");
  }
}
