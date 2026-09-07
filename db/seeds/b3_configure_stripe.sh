#!/usr/bin/env bash
# FadeUp — B3 : configuration Stripe (mode test) et installation des secrets.
#
# CE QUE FAIT CE SCRIPT, DANS L'ORDRE
#
#   1. installe la clé secrète Stripe dans supabase_vault (stripe_secret_key)
#      — même motif que la clé Resend de B2 : chiffrée, lisible par les seules
#      fonctions private.*, jamais dans un fichier suivi ni dans un log ;
#   2. crée (ou retrouve) le webhook endpoint de mode test pointant sur
#      https://fade-up.com/functions/v1/stripe-webhook, abonné aux sept
#      événements du chantier 4 ;
#   3. écrit le secret de signature dans infra/supabase/.env (non suivi) —
#      c'est de là que docker-compose le passe à la fonction Edge — et dans le
#      vault (stripe_webhook_secret) pour la barrière côté base ;
#   4. configure le portail client : moyen de paiement, factures, résiliation
#      en fin de période.
#
# IDEMPOTENT : l'endpoint est retrouvé par son URL ; le portail par sa
# configuration par défaut ; le vault est mis à jour, pas dupliqué.
#
# AUCUNE VALEUR N'EST AFFICHÉE. Les clés voyagent par l'environnement des
# processus et l'entrée standard de psql, jamais par argv ni par echo.
#
# MODE TEST UNIQUEMENT : refus immédiat d'une clé qui n'est pas sk_test_.
#
# Usage :
#   db/seeds/b3_configure_stripe.sh
#   B3_TARGET_DB=b3_restore B3_DB_CONTAINER=fadeup-b3-sandbox db/seeds/b3_configure_stripe.sh

set -euo pipefail

ENV_FILE="${FADEUP_SUPABASE_ENV:-/opt/fadeup/infra/supabase/.env}"
DB_CONTAINER="${B3_DB_CONTAINER:-fadeup-supabase-db}"
TARGET_DB="${B3_TARGET_DB:-postgres}"
API="https://api.stripe.com/v1"
WEBHOOK_URL="${B3_WEBHOOK_URL:-https://fade-up.com/functions/v1/stripe-webhook}"

if [[ ! -r "$ENV_FILE" ]]; then
  echo "impossible de lire $ENV_FILE" >&2
  exit 2
fi

SK="$(sed -n 's/^STRIPE_SECRET_KEY=//p' "$ENV_FILE" | head -1 | tr -d '\r"')"
if [[ -z "$SK" ]]; then
  echo "STRIPE_SECRET_KEY absent de $ENV_FILE" >&2
  exit 2
fi
if [[ ! "$SK" =~ ^sk_test_ ]]; then
  echo "REFUS : clé non-test. Le passage en mode réel est une décision du fondateur." >&2
  exit 3
fi

stripe_curl() {
  curl -sS --config <(printf 'user = "%s:"\n' "$SK") "$@"
}

# Écrit UNE valeur secrète dans le vault, sans l'afficher : la valeur passe
# par l'environnement de docker exec puis par \set de psql (littéral quoté,
# normalisé en $1 par pg_stat_statements). Le motif exact de B2.
vault_put() {
  local name="$1" value="$2" descr="$3"
  docker exec -i -e B3_SECRET_VALUE="$value" "$DB_CONTAINER" \
    psql -U postgres -d "$TARGET_DB" -v ON_ERROR_STOP=1 -q <<SQL
\\set v \`echo "\$B3_SECRET_VALUE"\`
select vault.create_secret(:'v', '$name', '$descr')
where not exists (select 1 from vault.secrets where name = '$name');
select vault.update_secret(
         (select id from vault.secrets where name = '$name'),
         :'v', '$name', '$descr')
where exists (select 1 from vault.secrets where name = '$name');
SQL
}

echo "==> 1/4 clé secrète Stripe dans le vault ($TARGET_DB)"
vault_put stripe_secret_key "$SK" \
  'Cle secrete Stripe, MODE TEST. Installee par db/seeds/b3_configure_stripe.sh. Lue par private.stripe_secret_key().'
docker exec -i "$DB_CONTAINER" psql -U postgres -d "$TARGET_DB" -tA -c "
  select 'vault: stripe_secret_key installee, ' || length(private.stripe_secret_key()) ||
         ' caracteres, prefixe ' || left(private.stripe_secret_key(), 8) || '...';"

echo "==> 2/4 webhook endpoint (mode test)"
EXISTING="$(stripe_curl "$API/webhook_endpoints?limit=100" \
  | jq -r --arg u "$WEBHOOK_URL" '.data[] | select(.url == $u) | .id' | head -1)"

EVENTS=(checkout.session.completed customer.subscription.created customer.subscription.updated \
        customer.subscription.deleted invoice.paid invoice.payment_failed customer.subscription.trial_will_end)

WHSEC=""
if [[ -n "$EXISTING" ]]; then
  # Le secret d'un endpoint n'est montré qu'à la création. S'il manque dans
  # .env, on recrée l'endpoint plutôt que de vivre avec un secret perdu.
  CURRENT="$(sed -n 's/^STRIPE_WEBHOOK_SECRET=//p' "$ENV_FILE" | head -1 | tr -d '\r"')"
  if [[ -n "$CURRENT" ]]; then
    echo "    endpoint existant réutilisé ($EXISTING), secret déjà dans .env"
    WHSEC="$CURRENT"
    # S'assure que la liste d'événements est complète.
    args=(); for e in "${EVENTS[@]}"; do args+=(-d "enabled_events[]=$e"); done
    stripe_curl "$API/webhook_endpoints/$EXISTING" "${args[@]}" >/dev/null
  else
    echo "    endpoint existant sans secret connu : recréation ($EXISTING supprimé)"
    stripe_curl -X DELETE "$API/webhook_endpoints/$EXISTING" >/dev/null
    EXISTING=""
  fi
fi

if [[ -z "$EXISTING" ]]; then
  args=(-d "url=$WEBHOOK_URL" --data-urlencode "description=FadeUp B3 (mode test)")
  for e in "${EVENTS[@]}"; do args+=(-d "enabled_events[]=$e"); done
  CREATED="$(stripe_curl "$API/webhook_endpoints" "${args[@]}")"
  WHSEC="$(echo "$CREATED" | jq -r '.secret // empty')"
  EP_ID="$(echo "$CREATED" | jq -r '.id // empty')"
  if [[ -z "$WHSEC" || -z "$EP_ID" ]]; then
    echo "ÉCHEC : création du webhook endpoint" >&2
    echo "$CREATED" | jq 'del(.secret)' >&2
    exit 1
  fi
  echo "    endpoint créé : $EP_ID -> $WEBHOOK_URL (${#EVENTS[@]} événements)"
fi

echo "==> 3/4 secret de signature : .env + vault"
if grep -q '^STRIPE_WEBHOOK_SECRET=' "$ENV_FILE"; then
  # sed avec la valeur dans l'environnement, pas dans la ligne de commande.
  WHSEC_ENV="$WHSEC" python3 - "$ENV_FILE" <<'PY'
import os, sys
path = sys.argv[1]
value = os.environ['WHSEC_ENV']
lines = open(path).read().splitlines(keepends=True)
out = []
for l in lines:
    if l.startswith('STRIPE_WEBHOOK_SECRET='):
        out.append(f'STRIPE_WEBHOOK_SECRET={value}\n')
    else:
        out.append(l)
open(path, 'w').writelines(out)
PY
else
  WHSEC_ENV="$WHSEC" python3 - "$ENV_FILE" <<'PY'
import os, sys
with open(sys.argv[1], 'a') as f:
    f.write(f"STRIPE_WEBHOOK_SECRET={os.environ['WHSEC_ENV']}\n")
PY
fi
echo "    .env mis à jour (valeur jamais affichée)"

vault_put stripe_webhook_secret "$WHSEC" \
  'Secret de signature du webhook Stripe, MODE TEST. Installe par db/seeds/b3_configure_stripe.sh. Lu par private.stripe_webhook_secret().'
docker exec -i "$DB_CONTAINER" psql -U postgres -d "$TARGET_DB" -tA -c "
  select 'vault: stripe_webhook_secret installe, ' || length(private.stripe_webhook_secret()) ||
         ' caracteres, prefixe ' || left(private.stripe_webhook_secret(), 6) || '...';"

echo "==> 4/4 portail client"
PORTAL_ID="$(stripe_curl "$API/billing_portal/configurations?limit=100" \
  | jq -r '.data[] | select(.is_default == true) | .id' | head -1)"

PORTAL_ARGS=(
  -d "business_profile[headline]=FadeUp"
  -d "features[payment_method_update][enabled]=true"
  -d "features[invoice_history][enabled]=true"
  -d "features[customer_update][enabled]=true"
  -d "features[customer_update][allowed_updates][]=email"
  -d "features[customer_update][allowed_updates][]=address"
  -d "features[customer_update][allowed_updates][]=tax_id"
  -d "features[subscription_cancel][enabled]=true"
  -d "features[subscription_cancel][mode]=at_period_end"
  -d "default_return_url=https://fade-up.com/pro/billing"
)

if [[ -n "$PORTAL_ID" ]]; then
  stripe_curl "$API/billing_portal/configurations/$PORTAL_ID" "${PORTAL_ARGS[@]}" >/dev/null
  echo "    configuration par défaut mise à jour ($PORTAL_ID)"
else
  NEW_PORTAL="$(stripe_curl "$API/billing_portal/configurations" "${PORTAL_ARGS[@]}")"
  echo "    configuration créée ($(echo "$NEW_PORTAL" | jq -r .id))"
fi

echo "==> terminé — tout en mode test"
