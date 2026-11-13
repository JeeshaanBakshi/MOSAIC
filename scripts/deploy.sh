#!/usr/bin/env bash
# Build the MOSAIC contract, deploy it to TESTNET, set it up (init), and record the public IDs.
# Needs the Stellar CLI keys `admin` and `usdc_issuer` (they live in the CLI keystore, never in this repo).
# Run:  ./scripts/deploy.sh [alias] [output-file]
#   alias        default mosaic_v3. It never touches an existing alias unless you reuse its name.
#   output-file  default deployments/<alias>.json, so a test deploy can never overwrite the main contract record
#                (deployments/testnet.json). Pass that path on purpose to replace it.
set -euo pipefail
cd "$(dirname "$0")/.."
NET=testnet
ALIAS="${1:-mosaic_v3}"
OUT="${2:-deployments/${ALIAS}.json}"

ISSUER=$(stellar keys public-key usdc_issuer)
ADMIN=$(stellar keys public-key admin)
# The test USDC coin: a classic asset wrapped as a Soroban token (the "Stellar Asset Contract"). Same id every time.
USDC=$(stellar contract id asset --asset "USDC:$ISSUER" --network $NET)

stellar contract build
stellar contract deploy --wasm target/wasm32v1-none/release/mosaic.wasm --source admin --network $NET --alias "$ALIAS"
ID=$(stellar contract alias show "$ALIAS" | tail -1)

# 1 USDC fee per lender check, 70% to the issuers, 30 USDC stake per credential (7 decimals).
stellar contract invoke --id "$ID" --source admin --network $NET -- init \
  --admin "$ADMIN" --usdc "$USDC" --verify_fee 10000000 --issuer_share_bps 7000 --stake_amount 300000000

# Public IDs only. Secret keys (S...) never go in this file.
cat > "$OUT" <<JSON
{
  "network": "testnet",
  "contract": "$ID",
  "usdc": "$USDC",
  "usdc_issuer": "$ISSUER",
  "admin": "$ADMIN",
  "explorer": "https://stellar.expert/explorer/testnet/contract/$ID"
}
JSON
echo "Deployed $ALIAS: $ID (recorded in $OUT)"
