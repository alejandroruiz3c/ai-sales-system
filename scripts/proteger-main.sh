#!/usr/bin/env bash
# Protección de `main`, secret scanning y push protection (F0.7).
#
# Estas tres cosas no se pueden poner en un fichero del repositorio: son ajustes
# del repositorio en GitHub. Este script las aplica con la API.
#
# Requiere `gh` autenticado como administrador del repositorio.
#
#   ./scripts/proteger-main.sh
#
set -euo pipefail

REPO="${SALES_OS_REPO:-turbineh/ai-sales-system}"

echo "▸ Protegiendo main en $REPO"

# Los checks requeridos son exactamente los nombres de los jobs de ci.yml.
gh api -X PUT "repos/$REPO/branches/main/protection" \
  --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["Lint · Typecheck · Test · Build"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "require_code_owner_reviews": true,
    "dismiss_stale_reviews": true,
    "require_last_push_approval": false
  },
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": true,
  "block_creations": false
}
JSON

echo "▸ Secret scanning y push protection"
gh api -X PATCH "repos/$REPO" \
  -F 'security_and_analysis[secret_scanning][status]=enabled' \
  -F 'security_and_analysis[secret_scanning_push_protection][status]=enabled' \
  >/dev/null

echo "▸ Solo squash merge, y borrar la rama al fusionar"
gh api -X PATCH "repos/$REPO" \
  -F allow_squash_merge=true \
  -F allow_merge_commit=false \
  -F allow_rebase_merge=false \
  -F delete_branch_on_merge=true \
  -F allow_auto_merge=true \
  >/dev/null

echo
echo "Hecho. Comprueba que se cumple (caso T0.4 del kit de F0):"
echo "  intenta editar un fichero en main desde la web de GitHub;"
echo "  tiene que obligarte a crear una rama y un PR."
