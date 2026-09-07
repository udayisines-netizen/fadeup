#!/usr/bin/env bash
# FadeUp — B3, chantier 1 : synchronise le catalogue Stripe depuis la base.
#
# LA BASE FAIT AUTORITÉ, STRIPE LA REFLÈTE
#
# Ce script lit `public.commercial_plans` et fait exister chez Stripe, en mode
# test, un produit par plan payant et deux prix par produit — mensuel et
# annuel. Il n'écrit JAMAIS la base à partir de Stripe : le seul sens de
# synchronisation est base -> Stripe, et les tables billing_stripe_products /
# billing_stripe_prices enregistrent ce qui a été créé.
#
# IDEMPOTENT, TROIS FOIS
#
#   1. par la base : si billing_stripe_prices a déjà un prix actif au bon
#      montant pour ce plan et cet intervalle, rien n'est créé ;
#   2. par Stripe : chaque produit est créé AVEC UN IDENTIFIANT DÉTERMINISTE
#      (`prod_` n'est pas imposable, mais `id` l'est à la création d'un
#      Product). Deux exécutions concurrentes ne peuvent pas créer deux
#      produits pour le même plan : la seconde reçoit "resource_already_exists" ;
#   3. par la clé d'idempotence Stripe (`Idempotency-Key`) sur la création des
#      prix, dérivée du plan, de l'intervalle et du montant : le rejeu d'une
#      création interrompue renvoie le même objet au lieu d'en créer un second.
#
# CHANGEMENT DE TARIF
#
# Un Price Stripe est immuable. Si le montant en base ne correspond plus au
# prix actif enregistré, le script crée un NOUVEAU prix, archive l'ancien chez
# Stripe (active=false) et dans la base (is_active=false, archived_at), et les
# abonnements en cours RESTENT sur l'ancien prix. C'est voulu et documenté :
# une hausse de tarif ne s'applique jamais d'office à un client existant.
#
# TVA
#
# Les montants de commercial_plans sont HORS TAXE : chaque prix est créé avec
# tax_behavior=exclusive, et chaque produit porte le code fiscal des services
# fournis par voie électronique. Stripe Tax (actif sur le compte, vérifié)
# calcule la TVA selon le pays du client au moment du Checkout.
#
# SECRETS
#
# La clé est lue depuis infra/supabase/.env, jamais affichée, jamais passée en
# argument de ligne de commande (elle serait visible dans `ps`) : curl la lit
# via --config sur un descripteur de fichier éphémère.
#
# MODE TEST — GARDE-FOU BLOQUANT
#
# Le script REFUSE de travailler avec une clé qui ne commence pas par sk_test_.
# Le passage en mode réel est une décision du fondateur, pas un paramètre.
#
# Usage :
#   db/seeds/b3_sync_stripe_catalog.sh                    # base de production
#   B3_TARGET_DB=b3_restore B3_DB_CONTAINER=fadeup-b3-sandbox \
#     db/seeds/b3_sync_stripe_catalog.sh                  # bac d'essai

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${FADEUP_SUPABASE_ENV:-/opt/fadeup/infra/supabase/.env}"
DB_CONTAINER="${B3_DB_CONTAINER:-fadeup-supabase-db}"
TARGET_DB="${B3_TARGET_DB:-postgres}"
API="https://api.stripe.com/v1"

if [[ ! -r "$ENV_FILE" ]]; then
  echo "impossible de lire $ENV_FILE" >&2
  exit 2
fi

SK="$(sed -n 's/^STRIPE_SECRET_KEY=//p' "$ENV_FILE" | head -1 | tr -d '\r"')"
if [[ -z "$SK" ]]; then
  echo "STRIPE_SECRET_KEY absent de $ENV_FILE" >&2
  exit 2
fi

# LE garde-fou. Une clé sk_live_ arrête tout, immédiatement.
if [[ ! "$SK" =~ ^sk_test_ ]]; then
  echo "REFUS : la clé Stripe n'est pas une clé de TEST (préfixe sk_test_ attendu)." >&2
  echo "Le passage en mode réel est une décision du fondateur, hors de ce script." >&2
  exit 3
fi

# La clé descend vers curl par un fichier de configuration sur descripteur
# éphémère : absente d'argv, absente de l'environnement des sous-processus.
stripe_curl() {
  curl -sS --config <(printf 'user = "%s:"\n' "$SK") "$@"
}

psql_q() {
  docker exec -i "$DB_CONTAINER" psql -U postgres -d "$TARGET_DB" -Atq -v ON_ERROR_STOP=1 "$@"
}

echo "==> catalogue depuis $TARGET_DB (conteneur $DB_CONTAINER), Stripe en mode test"

CREATED=0
REUSED=0
ARCHIVED=0

# Chaque plan payant. `free` n'a pas de produit Stripe : on ne facture pas 0 €.
# Lecture sur le descripteur 3 : les commandes du corps de boucle (docker
# exec -i, curl) consomment stdin, et une boucle qui lit sur stdin s'arrête
# alors au premier plan — constaté à la première exécution : seul `solo`
# était synchronisé.
while IFS='|' read -u 3 -r plan display monthly annual currency; do
  [[ -z "$plan" ]] && continue

  # -------------------------------------------------------------- produit --
  # Identifiant Stripe DÉTERMINISTE : fadeup_<plan>. C'est lui qui rend la
  # création idempotente côté Stripe, indépendamment de l'état de la base.
  PRODUCT_ID="fadeup_${plan}"

  HTTP="$(stripe_curl -o /tmp/b3-stripe-out.json -w '%{http_code}' "$API/products/$PRODUCT_ID")"
  if [[ "$HTTP" == "200" ]]; then
    REUSED=$((REUSED+1))
  else
    stripe_curl -o /tmp/b3-stripe-out.json -w '' "$API/products" \
      -d "id=$PRODUCT_ID" \
      --data-urlencode "name=FadeUp $display ($plan)" \
      -d "metadata[fadeup_plan_key]=$plan" \
      -d "metadata[managed_by]=b3_sync_stripe_catalog" \
      -d "tax_code=txcd_10000000" >/dev/null
    # Relit pour vérifier — une création qui a échoué doit arrêter le script,
    # pas laisser un demi-catalogue.
    HTTP="$(stripe_curl -o /tmp/b3-stripe-out.json -w '%{http_code}' "$API/products/$PRODUCT_ID")"
    if [[ "$HTTP" != "200" ]]; then
      echo "ÉCHEC : le produit $PRODUCT_ID n'existe pas après création" >&2
      cat /tmp/b3-stripe-out.json >&2
      exit 1
    fi
    CREATED=$((CREATED+1))
    echo "    produit créé : $PRODUCT_ID"
  fi

  LIVEMODE="$(jq -r '.livemode' /tmp/b3-stripe-out.json)"
  if [[ "$LIVEMODE" != "false" ]]; then
    echo "REFUS : le produit $PRODUCT_ID est en mode RÉEL. Arrêt immédiat." >&2
    exit 3
  fi

  psql_q -c "insert into public.billing_stripe_products (plan_key, stripe_product_id, livemode)
             values ('$plan', '$PRODUCT_ID', false)
             on conflict (plan_key) do update
               set stripe_product_id = excluded.stripe_product_id, livemode = false;" >/dev/null

  # ---------------------------------------------------------------- prix --
  # Deux intervalles, montants pris du catalogue — jamais recalculés ici.
  for pair in "month:$monthly" "year:$annual"; do
    interval="${pair%%:*}"
    amount="${pair##*:}"

    ACTIVE="$(psql_q -c "select stripe_price_id || '|' || unit_amount_minor
                         from public.billing_stripe_prices
                         where plan_key='$plan' and billing_interval='$interval'
                           and livemode=false and is_active;")"
    active_id="${ACTIVE%%|*}"
    active_amount="${ACTIVE##*|}"

    if [[ -n "$ACTIVE" && "$active_amount" == "$amount" ]]; then
      # Le prix actif correspond au catalogue : rien à faire. C'est le chemin
      # du rejeu — la deuxième exécution passe entièrement par ici.
      continue
    fi

    if [[ -n "$ACTIVE" && "$active_amount" != "$amount" ]]; then
      # Changement de tarif : nouveau prix, archivage de l'ancien, les
      # abonnements en cours restent où ils sont.
      echo "    tarif changé pour $plan/$interval : $active_amount -> $amount, archivage de $active_id"
      stripe_curl "$API/prices/$active_id" -d "active=false" >/dev/null
      psql_q -c "update public.billing_stripe_prices
                 set is_active=false, archived_at=now()
                 where stripe_price_id='$active_id';" >/dev/null
      ARCHIVED=$((ARCHIVED+1))
    fi

    # Clé d'idempotence dérivée du contenu : rejouer la même création rend le
    # même objet. Un changement de montant change la clé, donc crée bien un
    # nouveau prix.
    IDEM="fadeup-b3-${plan}-${interval}-${amount}-${currency}"
    stripe_curl -o /tmp/b3-stripe-price.json "$API/prices" \
      -H "Idempotency-Key: $IDEM" \
      -d "product=$PRODUCT_ID" \
      -d "currency=${currency,,}" \
      -d "unit_amount=$amount" \
      -d "recurring[interval]=$interval" \
      -d "tax_behavior=exclusive" \
      -d "nickname=$plan $interval" \
      -d "metadata[fadeup_plan_key]=$plan" \
      -d "metadata[fadeup_interval]=$interval" >/dev/null

    PRICE_ID="$(jq -r '.id // empty' /tmp/b3-stripe-price.json)"
    P_LIVEMODE="$(jq -r '.livemode' /tmp/b3-stripe-price.json)"
    if [[ -z "$PRICE_ID" ]]; then
      echo "ÉCHEC : création du prix $plan/$interval" >&2
      cat /tmp/b3-stripe-price.json >&2
      exit 1
    fi
    if [[ "$P_LIVEMODE" != "false" ]]; then
      echo "REFUS : le prix $PRICE_ID est en mode RÉEL. Arrêt immédiat." >&2
      exit 3
    fi

    psql_q -c "insert into public.billing_stripe_prices
                 (plan_key, billing_interval, stripe_price_id, unit_amount_minor, currency, livemode, is_active)
               values ('$plan', '$interval', '$PRICE_ID', $amount, '$currency', false, true)
               on conflict (stripe_price_id) do nothing;" >/dev/null
    CREATED=$((CREATED+1))
    echo "    prix créé : $plan/$interval = $amount ($PRICE_ID)"
  done
done 3< <(psql_q -c "select plan_key, display_name, price_minor, annual_price_minor, price_currency
                    from public.commercial_plans
                    where price_minor > 0
                    order by commercial_family, tier;")

rm -f /tmp/b3-stripe-out.json /tmp/b3-stripe-price.json
echo "==> terminé : $CREATED créé(s), $REUSED produit(s) retrouvé(s), $ARCHIVED archivé(s)"
