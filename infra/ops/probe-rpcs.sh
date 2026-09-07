#!/bin/bash
# FadeUp ops — sonde périodique des RPC publiques.
#
# db/tests/probe_public_rpcs.sh --strict teste déjà les 21 RPC publiques en
# anon via Kong, exactement comme le navigateur les appelle. Ce wrapper le
# fait tourner sous cron et transforme son verdict en alerte à état :
# un échec ouvre l'alerte (avec la table de sortie), le retour au 200 partout
# la referme. Le repo de production /opt/fadeup fournit le script et
# l'ANON_KEY (infra/supabase/.env) — rien n'est dupliqué ici.

set -uo pipefail

OPS_DIR="${OPS_DIR:-$HOME/ops}"
OPS_ENV="${OPS_ENV:-$OPS_DIR/.env}"
# shellcheck disable=SC1090
. "$OPS_ENV"

ALERT="$OPS_DIR/alert.sh"
REPO="${FADEUP_REPO:-/opt/fadeup}"
PROBE="$REPO/db/tests/probe_public_rpcs.sh"

if [ ! -x "$PROBE" ]; then
  "$ALERT" raise rpc-probe "Sonde RPC introuvable" \
    "$PROBE est absent ou non exécutable. Les RPC publiques ne sont plus sondées."
  exit 1
fi

if output=$("$PROBE" --strict 2>&1); then
  "$ALERT" clear rpc-probe "RPC publiques"
else
  # Ne garder que les lignes utiles : l'en-tête et tout ce qui n'est pas 200.
  summary=$(printf '%s\n' "$output" | awk 'NR<=2 || ($2 != "200" && NF>=2)' | head -30)
  "$ALERT" raise rpc-probe "RPC publiques en échec" \
    "probe_public_rpcs.sh --strict a échoué. Lignes hors 200 :

$summary

Chaque RPC publique est un écran client cassé. Sortie complète : relancer
$PROBE à la main."
fi
