-- CreateEnum
CREATE TYPE "JamType" AS ENUM ('SCREENSHOT', 'VIDEO');

-- CreateEnum
CREATE TYPE "JamVisibility" AS ENUM ('PUBLIC', 'WORKSPACE');

-- CreateTable
CREATE TABLE "Jam" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "type" "JamType" NOT NULL,
    "title" TEXT,
    "pageUrl" TEXT NOT NULL,
    "pageTitle" TEXT,
    "referrer" TEXT,
    "device" JSONB NOT NULL,
    "console" JSONB NOT NULL,
    "network" JSONB NOT NULL,
    "actions" JSONB,
    "durationMs" INTEGER,
    "visibility" "JamVisibility" NOT NULL DEFAULT 'PUBLIC',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Jam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JamAsset" (
    "id" TEXT NOT NULL,
    "jamId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JamAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Jam_workspaceId_createdAt_idx" ON "Jam"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "Jam_createdById_idx" ON "Jam"("createdById");

-- CreateIndex
CREATE INDEX "JamAsset_jamId_idx" ON "JamAsset"("jamId");

-- AddForeignKey
ALTER TABLE "Jam" ADD CONSTRAINT "Jam_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Jam" ADD CONSTRAINT "Jam_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JamAsset" ADD CONSTRAINT "JamAsset_jamId_fkey" FOREIGN KEY ("jamId") REFERENCES "Jam"("id") ON DELETE CASCADE ON UPDATE CASCADE;
