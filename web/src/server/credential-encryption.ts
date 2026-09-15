// Real AES-256-GCM encryption for external-connection secrets (GitHub access
// tokens). The existing WordPress/Google Search Console connections
// (prisma/schema.prisma's WordPressConnection/GoogleSearchConsoleConnection)
// store their tokens as plain columns -- a real, pre-existing gap this file
// does not retroactively fix (out of this task's scope; migrating existing
// connections is a separate, unrelated change). A repository-write credential
// is higher-stakes than a content-only one, and this task's own security
// requirements explicitly call for encrypted storage, so GitHubConnection
// uses this from the start rather than repeating the existing gap.
//
// Never logs, never includes ciphertext/plaintext in an error message, never
// derives the key from anything guessable -- CREDENTIAL_ENCRYPTION_KEY must
// be a real, explicitly-configured 32-byte key (base64 or hex), or every
// encrypt/decrypt call fails loudly rather than falling back to an
// unencrypted or weakly-derived default.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH_BYTES = 12;
const KEY_LENGTH_BYTES = 32;

export class CredentialEncryptionNotConfiguredError extends Error {
  constructor() {
    super(
      "CREDENTIAL_ENCRYPTION_KEY is not configured. A real GitHub connection cannot be stored without it -- " +
        "set a 32-byte key (base64 or 64-char hex) in the environment before connecting a real repository.",
    );
    this.name = "CredentialEncryptionNotConfiguredError";
  }
}

function loadKey(): Buffer {
  const raw = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!raw || raw.trim() === "") {
    throw new CredentialEncryptionNotConfiguredError();
  }
  let key: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    key = Buffer.from(raw, "hex");
  } else {
    key = Buffer.from(raw, "base64");
  }
  if (key.length !== KEY_LENGTH_BYTES) {
    throw new Error(`CREDENTIAL_ENCRYPTION_KEY must decode to exactly ${KEY_LENGTH_BYTES} bytes (got ${key.length}).`);
  }
  return key;
}

/** Encrypts `plaintext` (a real secret) into a single, storable string: `<iv>:<authTag>:<ciphertext>`, each base64. */
export function encryptSecret(plaintext: string): string {
  const key = loadKey();
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(":");
}

/** Decrypts a value produced by encryptSecret(). Throws (never returns a corrupted/partial secret) if the stored value was tampered with or the key is wrong -- GCM's auth tag makes this verifiable, not just hopeful. */
export function decryptSecret(stored: string): string {
  const key = loadKey();
  const parts = stored.split(":");
  if (parts.length !== 3) {
    throw new Error("Stored credential is not in the expected <iv>:<authTag>:<ciphertext> format.");
  }
  const [ivB64, authTagB64, ciphertextB64] = parts;
  const iv = Buffer.from(ivB64!, "base64");
  const authTag = Buffer.from(authTagB64!, "base64");
  const ciphertext = Buffer.from(ciphertextB64!, "base64");
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}

/** True if CREDENTIAL_ENCRYPTION_KEY is configured -- checked before ever attempting to store or use a real GitHub credential, so a missing key fails as an honest "not configured" state rather than a confusing crypto error deep in a request. */
export function isCredentialEncryptionConfigured(): boolean {
  try {
    loadKey();
    return true;
  } catch {
    return false;
  }
}
