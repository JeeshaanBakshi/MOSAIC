#!/usr/bin/env bash
# Cloud test: the REAL Upstash and Resend client code, against local stand-ins (no accounts or keys needed).
set -euo pipefail
cd "$(dirname "$0")/.."
node tests/fakes.mjs > /dev/null 2>&1 &
FAKES=$!
trap 'kill $FAKES 2>/dev/null || true' EXIT
sleep 1
MAX_CODES_PER_HOUR=1000 UPSTASH_REDIS_REST_URL=http://127.0.0.1:4401 UPSTASH_REDIS_REST_TOKEN=testtoken \
  RESEND_API_KEY=resend-test-key RESEND_API_URL=http://127.0.0.1:4402/emails \
  npx tsx --conditions=react-server tests/cloud.test.ts
