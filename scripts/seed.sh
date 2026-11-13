#!/usr/bin/env bash
# Put the website's demo on the REAL contract (Stellar TESTNET): approve the 4 issuers, issue the credentials about
# Sharma Store (shop-1) and Shop 3, and record which claims passed the backend's checks.
# Safe to run twice: it reads the chain first and only sends what is missing.
#
# Needs these Stellar CLI keys (they live in the CLI keystore, never in this repo). Who plays which role:
#   admin            -> MOSAIC admin / platform        usdc_issuer -> issues the test USDC
#   supplier         -> Issuer 1, the honest supplier  payment_provider -> Issuer 2, the payment app
#   fake_issuer      -> Issuer 3, QuickSupply          self_dealer -> Issuer 4, the self-dealing supplier
#   lender           -> Lender 1
# Run:  ./scripts/seed.sh [contract-alias]      (default: the contract id in deployments/testnet.json)
set -euo pipefail
cd "$(dirname "$0")/.."
NET=testnet
ID="${1:-$(python3 -c 'import json;print(json.load(open("deployments/testnet.json"))["contract"])')}"
inv() { stellar contract invoke --id "$ID" --network $NET "$@" 2>&1; }
pub() { stellar keys public-key "$1"; }
hash() { printf '%s' "$1" | shasum -a 256 | cut -d' ' -f1; }

echo "Contract: $ID"
echo "Explorer: https://stellar.expert/explorer/testnet/contract/$ID"

approve() { # key name kind
  local who; who=$(pub "$1")
  if inv --source admin -- get_issuer --issuer "$who" | tail -1 | grep -q '^null'; then
    inv --source admin -- add_issuer --issuer "$who" --name "\"$2\"" --kind "\"$3\"" | grep -E "stellar.expert|rror" | head -1
    echo "  approved   $2 ($1)"
  else
    echo "  already approved: $2 ($1)"
  fi
}

issue() { # key shop claim_type summary
  local who creds exists; who=$(pub "$1")
  creds=$(inv --source admin -- get_credentials --shop_id "\"$2\"" | tail -1)
  exists=$(python3 - "$who" "$3" <<PY
import json,sys
who,ctype=sys.argv[1],sys.argv[2]
try: rows=json.loads('''$creds''')
except Exception: rows=[]
print("yes" if any(r["credential"]["issuer"]==who and r["credential"]["claim_type"]==ctype and not r["credential"]["revoked"] for r in rows) else "no")
PY
)
  if [ "$exists" = "yes" ]; then echo "  already issued: $1 -> $2 ($3)"; return; fi
  local h; h=$(hash "$2|$who|$3|$4")
  inv --source "$1" -- issue_credential --issuer "$who" --shop_id "\"$2\"" --claim_type "$3" --summary "\"$4\"" --claim_hash "$h" --ttl_secs 0 | grep -E "stellar.expert|rror" | head -1
  echo "  issued     $1 -> $2 ($3): $4"
}

passed() { # key shop claim_type  (mark a claim as having passed the backend checks, unless it already is)
  local who row id p; who=$(pub "$1")
  row=$(inv --source admin -- get_credentials --shop_id "\"$2\"" | tail -1 | python3 -c "
import json,sys
rows=json.load(sys.stdin)
m=[r['credential'] for r in rows if r['credential']['issuer']=='$who' and r['credential']['claim_type']=='$3' and not r['credential']['revoked']]
c=max(m,key=lambda c:int(c['id'])) if m else None
print(c['id'], str(c['passed']).lower()) if c else print('none')")
  if [ "$row" = "none" ]; then echo "  (no credential to mark: $1 $2 $3)"; return; fi
  id=${row% *}; p=${row#* }
  if [ "$p" = "true" ]; then echo "  already marked passed: #$id"; return; fi
  inv --source admin -- mark_checked --id "$id" --passed true | grep -E "stellar.expert|rror" | head -1
  echo "  marked     #$id passed the checks"
}

echo "1. Approve the issuers (check 1)"
approve supplier "Issuer 1" Supplier
approve payment_provider "Issuer 2" PaymentProvider
approve fake_issuer "Issuer 3" Supplier
approve self_dealer "Issuer 4" Supplier

echo "2. Issue the credentials (each locks 30 USDC)"
issue supplier shop-1 buyer "Regular buyer for 18 months, buys ₹45,000 a month, pays on time"
issue payment_provider shop-1 receipts "Payment-app (UPI) receipts above ₹50,000 a month for 6 months"
issue fake_issuer shop-1 buyer "Buys ₹1,50,000 a month from us for 12 months"
issue self_dealer shop-1 buyer "Regular buyer for 12 months, buys ₹45,000 a month, pays on time"
issue fake_issuer shop-3 buyer "Buys ₹1,50,000 a month from us for 6 months"

echo "3. Record which claims passed the backend's checks (the honest ones)"
passed supplier shop-1 buyer
passed payment_provider shop-1 receipts

echo "Done. Credentials on shop-1: $(inv --source admin -- list_shops | tail -1)"
