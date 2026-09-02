-- Vigía · esquema inicial

CREATE TABLE "Admin" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'admin',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3),
    CONSTRAINT "Admin_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Admin_email_key" ON "Admin"("email");

CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Team_name_key" ON "Team"("name");

CREATE TABLE "EnrollToken" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "teamId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "usedAt" TIMESTAMP(3),
    "usedByDeviceId" TEXT,
    CONSTRAINT "EnrollToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EnrollToken_token_key" ON "EnrollToken"("token");

CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "secretHash" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "os" TEXT NOT NULL,
    "osVersion" TEXT NOT NULL DEFAULT '',
    "username" TEXT NOT NULL DEFAULT '',
    "agentVersion" TEXT NOT NULL DEFAULT '',
    "teamId" TEXT,
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3),
    "consentAcceptedAt" TIMESTAMP(3),
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Device_teamId_idx" ON "Device"("teamId");
CREATE INDEX "Device_lastSeenAt_idx" ON "Device"("lastSeenAt");

CREATE TABLE "Screenshot" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "monitor" INTEGER NOT NULL DEFAULT 0,
    "path" TEXT NOT NULL,
    "thumbPath" TEXT NOT NULL,
    "width" INTEGER NOT NULL DEFAULT 0,
    "height" INTEGER NOT NULL DEFAULT 0,
    "bytes" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "Screenshot_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Screenshot_deviceId_capturedAt_idx" ON "Screenshot"("deviceId", "capturedAt");

CREATE TABLE "ActivitySample" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3) NOT NULL,
    "durationSec" INTEGER NOT NULL,
    "appName" TEXT NOT NULL,
    "windowTitle" TEXT NOT NULL DEFAULT '',
    "url" TEXT NOT NULL DEFAULT '',
    "keyboardCount" INTEGER NOT NULL DEFAULT 0,
    "mouseCount" INTEGER NOT NULL DEFAULT 0,
    "idleSec" INTEGER NOT NULL DEFAULT 0,
    "category" TEXT NOT NULL DEFAULT 'neutral',
    CONSTRAINT "ActivitySample_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ActivitySample_deviceId_startedAt_idx" ON "ActivitySample"("deviceId", "startedAt");
CREATE INDEX "ActivitySample_category_idx" ON "ActivitySample"("category");

CREATE TABLE "KeyboardEvent" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "kind" TEXT NOT NULL,
    "keysCount" INTEGER NOT NULL DEFAULT 0,
    "specialKeys" TEXT NOT NULL DEFAULT '',
    "textChunk" TEXT,
    CONSTRAINT "KeyboardEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "KeyboardEvent_deviceId_at_idx" ON "KeyboardEvent"("deviceId", "at");

CREATE TABLE "ProductivityRule" (
    "id" TEXT NOT NULL,
    "matchType" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "forbidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductivityRule_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProductivityRule_priority_idx" ON "ProductivityRule"("priority");

CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Alert_deviceId_createdAt_idx" ON "Alert"("deviceId", "createdAt");
CREATE INDEX "Alert_acknowledgedAt_idx" ON "Alert"("acknowledgedAt");

CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

ALTER TABLE "EnrollToken" ADD CONSTRAINT "EnrollToken_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Device" ADD CONSTRAINT "Device_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Screenshot" ADD CONSTRAINT "Screenshot_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ActivitySample" ADD CONSTRAINT "ActivitySample_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KeyboardEvent" ADD CONSTRAINT "KeyboardEvent_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
