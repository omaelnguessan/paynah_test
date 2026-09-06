#!/usr/bin/env bash
# Parcours de test manuel de bout en bout.
# Prérequis : make up && make migrate && make seed
set -uo pipefail

ACCOUNTS=${ACCOUNTS:-http://localhost:3001}
TRANSACTIONS=${TRANSACTIONS:-http://localhost:3002}
PAYMENTS=${PAYMENTS:-http://localhost:3003}

# Wallets du seed
SOURCE=wlt_01m1w561mssmxtq4t9d3nxne0z   # Awa — Compte principal, 500 000, Active
EMPTY=wlt_01m1w561mxg528wnmpp29t2mn1    # Awa — Compte épargne, 0, Active
DEST=wlt_01m1wf07y7qqyrfc0db4sw2j5e     # Kofi — Compte marchand, Active
FROZEN=wlt_01m1w561n10fnrj393ennxgrdy   # Salif — Compte bloqué, Frozen
USER_REF=usr_01m1w561mk8a64ktxykv95n8mf # Awa

RUN=$(date +%s)
pass=0; fail=0
BODY=$(mktemp)
trap 'rm -f "$BODY"' EXIT

step() { printf '\n\033[1;36m▶ %s\033[0m\n' "$1"; }
# check <attendu-http> <libellé>  — lit $BODY et $CODE
check() {
  local want=$1 label=$2 got=$CODE
  python3 -m json.tool < "$BODY" 2>/dev/null || cat "$BODY"
  if [ "$got" = "$want" ]; then
    printf '\033[1;32m  ✓ %s (HTTP %s)\033[0m\n' "$label" "$got"; pass=$((pass+1))
  else
    printf '\033[1;31m  ✗ %s : attendu HTTP %s, obtenu %s\033[0m\n' "$label" "$want" "$got"; fail=$((fail+1))
  fi
}

# post/get renseignent $BODY (corps) et $CODE (statut HTTP)
post() {
  CODE=$(curl -s -o "$BODY" -w '%{http_code}' -X POST "$1" \
    -H 'content-type: application/json' -H "x-correlation-id: manual-$RUN" -d "$2")
}
get() { CODE=$(curl -s -o "$BODY" -w '%{http_code}' "$1"); }

payload() { # payload <transaction_id> <source> <dest> <montant>
  cat <<JSON
{"transaction_id":"$1","source_wallet_reference":"$2","destination_wallet_reference":"$3",
 "amount":$4,"currency":"XOF","description":"Paiement test manuel","lang":"fr",
 "metadata":{"user_reference":"$USER_REF"}}
JSON
}

step "1. Santé des trois services"
for svc in "$ACCOUNTS accounts" "$TRANSACTIONS transactions" "$PAYMENTS payments"; do
  set -- $svc; get "$1/health"; check 200 "health $2"
done

step "2. Solde initial de la source"
get "$ACCOUNTS/accounts/$SOURCE/balance"; check 200 "lecture du solde"
before=$(python3 -c "import json;print(json.load(open('$BODY'))['data']['balance'])")

step "3. Paiement nominal — 5 000 XOF, doit passer Approved"
TRX="manual-$RUN-ok"
post "$PAYMENTS/payments" "$(payload "$TRX" "$SOURCE" "$DEST" 5000)"
check 201 "paiement accepté"
PAY=$(python3 -c "import json;print(json.load(open('$BODY'))['data']['reference'])" 2>/dev/null)

step "4. Idempotence — même transaction_id, même corps : renvoie le même paiement"
post "$PAYMENTS/payments" "$(payload "$TRX" "$SOURCE" "$DEST" 5000)"
same=$(python3 -c "import json;print(json.load(open('$BODY'))['data']['reference'])" 2>/dev/null)
check 201 "rejeu idempotent"
[ "$same" = "$PAY" ] \
  && { printf '\033[1;32m  ✓ même référence : %s\033[0m\n' "$PAY"; pass=$((pass+1)); } \
  || { printf '\033[1;31m  ✗ référence différente : %s vs %s\033[0m\n' "$PAY" "$same"; fail=$((fail+1)); }

step "5. Conflit d'idempotence — même transaction_id, montant différent : 409"
post "$PAYMENTS/payments" "$(payload "$TRX" "$SOURCE" "$DEST" 9000)"
check 409 "IDEMPOTENCY_CONFLICT"

step "6. Le solde a bougé d'exactement 5 000"
get "$ACCOUNTS/accounts/$SOURCE/balance"
after=$(python3 -c "import json;print(json.load(open('$BODY'))['data']['balance'])")
printf '  avant=%s  après=%s  delta=%s\n' "$before" "$after" "$((before-after))"
[ "$((before-after))" = 5000 ] \
  && { printf '\033[1;32m  ✓ débit unique malgré le rejeu\033[0m\n'; pass=$((pass+1)); } \
  || { printf '\033[1;31m  ✗ delta inattendu\033[0m\n'; fail=$((fail+1)); }

step "7. Solde insuffisant — 201 mais status Declined / INSUFFICIENT_BALANCE"
post "$PAYMENTS/payments" "$(payload "manual-$RUN-nsf" "$EMPTY" "$DEST" 5000)"
check 201 "refus métier, pas une erreur HTTP"

step "8. Wallet gelé — la source est Frozen"
post "$PAYMENTS/payments" "$(payload "manual-$RUN-frozen" "$FROZEN" "$DEST" 5000)"
check 201 "WALLET_FROZEN"

step "9. Montant non multiple de 5 — refusé à la validation"
post "$PAYMENTS/payments" "$(payload "manual-$RUN-odd" "$SOURCE" "$DEST" 5001)"
check 400 "VALIDATION_FAILED"

step "10. Wallet inexistant (référence bien formée) — Declined / WALLET_NOT_FOUND"
post "$PAYMENTS/payments" "$(payload "manual-$RUN-404" "wlt_01m1w561mssmxtq4t9d3nxne99" "$DEST" 5000)"
check 201 "WALLET_NOT_FOUND"

step "10 bis. Référence mal formée — rejetée par la validation du DTO"
post "$PAYMENTS/payments" "$(payload "manual-$RUN-badref" "wlt_inexistant000000000000000" "$DEST" 5000)"
check 400 "VALIDATION_FAILED sur le format de référence"

step "11. Relecture du paiement (projection CQRS)"
get "$PAYMENTS/payments/$PAY"; check 200 "GET /payments/:reference"

step "12. Le ledger a reçu les deux écritures (via RabbitMQ, ~2 s)"
sleep 3
get "$TRANSACTIONS/transactions?wallet_reference=$SOURCE&per_page=5"
check 200 "historique du wallet source"
get "$TRANSACTIONS/transactions?wallet_reference=$DEST&per_page=5"
check 200 "historique du wallet destination"

step "13. Historique non scopé — doit être refusé (422)"
get "$TRANSACTIONS/transactions?per_page=5"; check 422 "scope obligatoire"

step "14. Garde interne — débit direct sans x-api-key"
BODY=$(mktemp)
CODE=$(curl -s -o "$BODY" -w '%{http_code}' -X POST "$ACCOUNTS/accounts/$SOURCE/debit" \
  -H 'content-type: application/json' -d '{"transaction_id":"nokey-1","amount":5,"currency":"XOF"}')
check 401 "endpoint interne protégé"

printf '\n\033[1m── %s réussis, %s échoués ──\033[0m\n' "$pass" "$fail"
[ "$fail" = 0 ]
