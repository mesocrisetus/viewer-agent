-- Nº de pantallas del equipo (para multi-monitor en vivo y reproducción)
ALTER TABLE "Device" ADD COLUMN "monitorCount" INTEGER NOT NULL DEFAULT 1;
