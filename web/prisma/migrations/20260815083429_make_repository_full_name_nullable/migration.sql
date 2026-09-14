-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_GitHubConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'github_oauth_app',
    "accountLogin" TEXT NOT NULL,
    "repositoryFullName" TEXT,
    "encryptedAccessToken" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "lastUsedAt" DATETIME,
    CONSTRAINT "GitHubConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_GitHubConnection" ("accountLogin", "createdAt", "encryptedAccessToken", "id", "lastUsedAt", "provider", "repositoryFullName", "scope", "status", "updatedAt", "userId") SELECT "accountLogin", "createdAt", "encryptedAccessToken", "id", "lastUsedAt", "provider", "repositoryFullName", "scope", "status", "updatedAt", "userId" FROM "GitHubConnection";
DROP TABLE "GitHubConnection";
ALTER TABLE "new_GitHubConnection" RENAME TO "GitHubConnection";
CREATE UNIQUE INDEX "GitHubConnection_userId_key" ON "GitHubConnection"("userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
