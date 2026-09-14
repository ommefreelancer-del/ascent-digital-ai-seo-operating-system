-- CreateTable
CREATE TABLE "Deliverable" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "campaignRecordId" TEXT,
    "type" TEXT NOT NULL DEFAULT 'client-report',
    "format" TEXT NOT NULL DEFAULT 'pdf',
    "status" TEXT NOT NULL DEFAULT 'generating',
    "storagePath" TEXT,
    "fileSize" INTEGER,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Deliverable_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Deliverable_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Deliverable_campaignRecordId_fkey" FOREIGN KEY ("campaignRecordId") REFERENCES "CampaignRecord" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Deliverable_userId_createdAt_idx" ON "Deliverable"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Deliverable_reportId_idx" ON "Deliverable"("reportId");
