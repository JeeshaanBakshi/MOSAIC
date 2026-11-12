#!/usr/bin/env bash
# Browser test: builds the app, runs it against local stand-ins for Upstash and Resend, and clicks through it in Chrome.
# Needs Google Chrome (set CHROME_PATH if it is not at the macOS default).
set -euo pipefail
cd "$(dirname "$0")/.."
PORT=3100
node tests/fakes.mjs > /dev/null 2>&1 &
FAKES=$!
SERVER=""
trap 'kill $FAKES $SERVER 2>/dev/null || true' EXIT
npx tsx tests/addresses.ts > tests/.addresses.json
npm run build > /dev/null
MAX_CODES_PER_HOUR=1000 UPSTASH_REDIS_REST_URL=http://127.0.0.1:4401 UPSTASH_REDIS_REST_TOKEN=testtoken \
  RESEND_API_KEY=resend-test-key RESEND_API_URL=http://127.0.0.1:4402/emails RESET_PASSWORD=secret \
  npm run start -- -p $PORT > /dev/null 2>&1 &
SERVER=$!
for i in $(seq 1 40); do curl -s -o /dev/null "localhost:$PORT/api/health" && break; sleep 1; done
BASE="http://localhost:$PORT" node tests/e2e.mjs
