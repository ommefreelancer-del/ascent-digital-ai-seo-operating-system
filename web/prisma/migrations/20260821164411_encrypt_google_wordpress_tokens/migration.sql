-- Renames plaintext Google/WordPress OAuth credential columns to their
-- encrypted-at-rest names, matching GitHubConnection.encryptedAccessToken's
-- existing convention. RENAME COLUMN preserves existing row data as-is (no
-- data loss) -- a separate one-time backfill script then re-encrypts any
-- existing plaintext values in place using the same AES-256-GCM mechanism
-- (server/credential-encryption.ts) GitHub already uses. New rows going
-- forward are encrypted by the application before this migration's INSERT
-- ever runs.

ALTER TABLE "GoogleSearchConsoleConnection" RENAME COLUMN "accessToken" TO "encryptedAccessToken";
ALTER TABLE "GoogleSearchConsoleConnection" RENAME COLUMN "refreshToken" TO "encryptedRefreshToken";

ALTER TABLE "GoogleServiceConnection" RENAME COLUMN "accessToken" TO "encryptedAccessToken";
ALTER TABLE "GoogleServiceConnection" RENAME COLUMN "refreshToken" TO "encryptedRefreshToken";

ALTER TABLE "WordPressConnection" RENAME COLUMN "appPassword" TO "encryptedAppPassword";
ALTER TABLE "WordPressConnection" RENAME COLUMN "accessToken" TO "encryptedAccessToken";
