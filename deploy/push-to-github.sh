#!/usr/bin/env bash
# Sube este repo a GitHub como repositorio PRIVADO en tu perfil.
#
# Requisitos: GitHub CLI (gh) instalado y con sesión iniciada.
#   1) gh auth login          (una sola vez; abre el navegador)
#   2) bash deploy/push-to-github.sh [nombre-del-repo]
#
# Por defecto el repo se llama "viewer-agent".
set -euo pipefail

REPO="${1:-viewer-agent}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

command -v gh >/dev/null || { echo "Falta GitHub CLI. Instálalo: winget install GitHub.cli"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "Inicia sesión primero:  gh auth login"; exit 1; }

[ -d .git ] || git init -b main
git add -A
git diff --cached --quiet || git commit -m "Actualización"

if git remote get-url origin >/dev/null 2>&1; then
  echo "Ya hay un 'origin'; solo hago push."
  git push -u origin HEAD
else
  gh repo create "$REPO" --private --source=. --remote=origin --push
fi

echo
echo "Listo. Repo privado:"
gh repo view --json url -q .url
