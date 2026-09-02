#!/bin/sh
set -e

echo "→ Aplicando migraciones de base de datos..."
npx prisma migrate deploy

echo "→ Asegurando admin inicial y ajustes por defecto..."
node dist/seed.js || echo "  (seed omitido o ya aplicado)"

echo "→ Arrancando servidor Vigía..."
exec node dist/index.js
