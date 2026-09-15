-- CreateTable
CREATE TABLE "WebDevelopmentChange" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "repositoryFullName" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "targetUrl" TEXT NOT NULL,
    "requestSummary" TEXT NOT NULL,
    "filesJson" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending_approval',
    "commitShasJson" TEXT,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" DATETIME,
    CONSTRAINT "WebDevelopmentChange_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "WebDevelopmentChange_userId_status_idx" ON "WebDevelopmentChange"("userId", "status");
