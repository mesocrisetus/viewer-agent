-- Tokens de alta reutilizables (despliegue a muchos equipos con un solo instalador)
ALTER TABLE "EnrollToken" ADD COLUMN "reusable" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "EnrollToken" ADD COLUMN "useCount" INTEGER NOT NULL DEFAULT 0;
