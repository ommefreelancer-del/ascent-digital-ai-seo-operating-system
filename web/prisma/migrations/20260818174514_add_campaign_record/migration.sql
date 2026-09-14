-- CreateTable
CREATE TABLE "CampaignRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "campaignName" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "dataAvailable" BOOLEAN NOT NULL,
    "phase" TEXT NOT NULL,
    "totalApprovedPublishers" INTEGER NOT NULL,
    "draftedCount" INTEGER NOT NULL,
    "skippedCount" INTEGER NOT NULL,
    "resultJson" TEXT NOT NULL,
    "decidedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CampaignRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "CampaignRecord_userId_updatedAt_idx" ON "CampaignRecord"("userId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignRecord_userId_campaignName_key" ON "CampaignRecord"("userId", "campaignName");
