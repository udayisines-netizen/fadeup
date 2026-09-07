#!/usr/bin/env bash
# FadeUp — B3 : test de fuite de secrets Stripe.
#
# ÉCHOUE (code 1) si la clé secrète Stripe ou le secret de webhook apparaît :
#   1. dans un fichier suivi par git ;
#   2. dans une variable VITE_* (fichiers d'environnement web, suivis ou non) ;
#   3. dans les logs des conteneurs FadeUp ;
#   4. dans le bundle web construit, s'il existe.
#
# Le test lit les VRAIES valeurs depuis .env pour chercher leurs occurrences,
# mais ne les affiche jamais : les correspondances sont comptées, pas montrées.
# Il cherche aussi les préfixes génériques (sk_test_, sk_live_, whsec_) dans
# les fichiers suivis — une clé d'un AUTRE compte Stripe committée par erreur
#   doit échouer aussi.

set -euo pipefail

REPO_ROOT="${B3_REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
ENV_FILE="${FADEUP_SUPABASE_ENV:-/opt/fadeup/infra/supabase/.env}"
FAILURES=0

fail() { echo "ÉCHEC : $1" >&2; FAILURES=$((FAILURES + 1)); }
ok()   { echo "ok    : $1"; }

SK="$(sed -n 's/^STRIPE_SECRET_KEY=//p' "$ENV_FILE" 2>/dev/null | head -1 | tr -d '\r"')"
WH="$(sed -n 's/^STRIPE_WEBHOOK_SECRET=//p' "$ENV_FILE" 2>/dev/null | head -1 | tr -d '\r"')"

cd "$REPO_ROOT"

# 1. Fichiers suivis par git : ni les valeurs réelles, ni AUCUNE clé au
#    préfixe secret. (pk_test_/pk_live_ — la clé publiable — est autorisée :
#    c'est la seule qui a le droit d'atteindre le frontend.)
#    Exception documentée : les deux lignes d'exemple COMMENTÉES du gabarit
#    docker-compose de Supabase (GOTRUE_HOOK_*_SECRETS: "v1,whsec_<exemple>"),
#    présentes en amont bien avant B3 — des valeurs d'illustration, pas des
#    secrets. Tout autre motif, y compris en commentaire, échoue.
N_PREFIX="$( (git grep -I -n -E 'sk_(test|live)_[A-Za-z0-9]{20,}|whsec_[A-Za-z0-9]{20,}|rk_(test|live)_[A-Za-z0-9]{20,}' -- . 2>/dev/null || true) \
  | { grep -vE '^\S+:[0-9]+:\s*#\s*GOTRUE_HOOK_[A-Z_]*SECRETS:' || true; } \
  | cut -d: -f1 | sort -u | wc -l)"
if [[ "$N_PREFIX" -gt 0 ]]; then
  fail "des clés au préfixe secret Stripe apparaissent dans $N_PREFIX fichier(s) suivi(s)"
else
  ok "aucun préfixe de clé secrète Stripe dans les fichiers suivis"
fi

if [[ -n "$SK" ]]; then
  N_SK="$( (git grep -I -l -F "$SK" -- . 2>/dev/null || true) | wc -l)"
  [[ "$N_SK" -gt 0 ]] && fail "la clé secrète réelle apparaît dans des fichiers suivis" \
                       || ok "la clé secrète réelle est absente des fichiers suivis"
fi
if [[ -n "$WH" ]]; then
  N_WH="$( (git grep -I -l -F "$WH" -- . 2>/dev/null || true) | wc -l)"
  [[ "$N_WH" -gt 0 ]] && fail "le secret de webhook réel apparaît dans des fichiers suivis" \
                       || ok "le secret de webhook réel est absent des fichiers suivis"
fi

# 2. Variables VITE_ : rien de secret ne doit porter ce préfixe, nulle part —
#    tout VITE_* finit dans le bundle du navigateur.
N_VITE="$( (grep -rIsl -E '^VITE_[A-Z_]*=(sk_|whsec_)' \
  "$REPO_ROOT"/apps/web/.env* "$REPO_ROOT"/infra/web/.env* /opt/fadeup/infra/web/.env* 2>/dev/null || true) | wc -l)"
if [[ "$N_VITE" -gt 0 ]]; then
  fail "une variable VITE_* porte une valeur secrète Stripe"
else
  ok "aucune variable VITE_* ne porte de secret Stripe"
fi

# 3. Logs des conteneurs FadeUp (dernières 5 000 lignes de chacun).
LOG_HITS=0
for c in $(docker ps --format '{{.Names}}' | grep '^fadeup-' || true); do
  if docker logs --tail 5000 "$c" 2>&1 | grep -qE 'sk_(test|live)_[A-Za-z0-9]{20,}|whsec_[A-Za-z0-9]{20,}'; then
    fail "une clé secrète Stripe apparaît dans les logs de $c"
    LOG_HITS=$((LOG_HITS + 1))
  fi
done
[[ "$LOG_HITS" -eq 0 ]] && ok "aucun secret Stripe dans les logs des conteneurs"

# 4. Le bundle web construit, s'il existe.
BUNDLE_HITS=0
for d in "$REPO_ROOT"/apps/web/dist /opt/fadeup/apps/web/dist; do
  if [[ -d "$d" ]] && grep -rqsE 'sk_(test|live)_[A-Za-z0-9]{20,}|whsec_[A-Za-z0-9]{20,}' "$d"; then
    fail "une clé secrète Stripe apparaît dans le bundle web ($d)"
    BUNDLE_HITS=$((BUNDLE_HITS + 1))
  fi
done
[[ "$BUNDLE_HITS" -eq 0 ]] && ok "aucun secret Stripe dans le bundle web"

if [[ "$FAILURES" -gt 0 ]]; then
  echo "== $FAILURES fuite(s) détectée(s) ==" >&2
  exit 1
fi
echo "== aucune fuite détectée =="
