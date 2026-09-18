#!/usr/bin/env bash
# Ajustes del repositorio en GitHub que sí existen en el plan gratuito (F0.7).
#
# Sustituye a `scripts/proteger-main.sh`, que se retiró: pedía protección de
# ramas y CodeQL, y ninguna de las dos existe en un repositorio privado de una
# cuenta personal gratuita (ADR 0007). Lo que queda aquí es lo que de verdad se
# puede aplicar; la protección de `main` la dan las tres capas del ADR.
#
# Es idempotente: se puede ejecutar tantas veces como haga falta.
#
#   ./scripts/ajustes-github.sh
#
# Requiere `gh` autenticado como administrador del repositorio.

set -euo pipefail

REPO="${SALES_OS_REPO:-alejandroruiz3c/ai-sales-system}"

echo "▸ Repositorio: $REPO"

echo "▸ Solo squash merge, y borrar la rama al fusionar"
# `squash` deja un commit por PR en `main`, que es lo que hace legible el
# historial y lo que espera el guardián para reconocer una fusión.
gh api -X PATCH "repos/$REPO" \
  -F allow_squash_merge=true \
  -F allow_merge_commit=false \
  -F allow_rebase_merge=false \
  -F delete_branch_on_merge=true \
  -F allow_auto_merge=true \
  --jq '"  squash=\(.allow_squash_merge) merge=\(.allow_merge_commit) rebase=\(.allow_rebase_merge) borrar_rama=\(.delete_branch_on_merge)"'

echo "▸ Plantilla de squash: título y cuerpo del PR"
gh api -X PATCH "repos/$REPO" \
  -f squash_merge_commit_title=PR_TITLE \
  -f squash_merge_commit_message=PR_BODY \
  >/dev/null

echo "▸ Secret scanning (puede no estar disponible en el plan gratuito)"
if gh api -X PATCH "repos/$REPO" \
     -F 'security_and_analysis[secret_scanning][status]=enabled' \
     -F 'security_and_analysis[secret_scanning_push_protection][status]=enabled' \
     >/dev/null 2>&1; then
  echo "  activado"
else
  echo "  NO disponible en este plan. Lo cubre en su lugar:"
  echo "    · la regla de ESLint que veta literales con pinta de secreto"
  echo "    · pnpm sistema-vacio, que falla si un KEYS.* o un .env llega a estar versionado"
  echo "    · ambos dentro de pnpm verify, que corre en el hook pre-push y en el build de Vercel"
fi

echo "▸ Alertas de Dependabot"
gh api -X PUT "repos/$REPO/vulnerability-alerts" >/dev/null 2>&1 \
  && echo "  activadas" \
  || echo "  no se han podido activar por API; míralo en Settings → Advanced Security"

echo
echo "Lo que este script NO puede hacer, y por qué (ADR 0007):"
echo "  · Proteger \`main\`: requiere plan de pago o repositorio público."
echo "  · Exigir revisión de CODEOWNERS: requiere una organización con equipos."
echo "  · CodeQL: no disponible en repositorios privados gratuitos."
echo
echo "Comprobación del caso T0.4 del kit de F0, que sí se puede hacer:"
echo "  git switch main && git commit --allow-empty -m 'chore: prueba' && git push"
echo "  → el hook pre-push tiene que rechazarlo con su mensaje."
