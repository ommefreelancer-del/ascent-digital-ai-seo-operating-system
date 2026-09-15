-- CreateTable
CREATE TABLE "SpreadsheetCleaningApproval" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "attachmentId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending_approval',
    "resultJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" DATETIME,
    CONSTRAINT "SpreadsheetCleaningApproval_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SpreadsheetCleaningApproval_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "Attachment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "SpreadsheetCleaningApproval_userId_status_createdAt_idx" ON "SpreadsheetCleaningApproval"("userId", "status", "createdAt");
