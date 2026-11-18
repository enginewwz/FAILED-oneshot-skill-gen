#!/usr/bin/env bash
# Check API key and DeepSeek API reachability without printing the key.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ -z "${DEEPSEEK_API_KEY:-}" ] && [ -r "$HOME/.deepseek_env" ]; then
  set -a
  . "$HOME/.deepseek_env"
  set +a
fi

if [ -n "${DEEPSEEK_API_KEY:-}" ]; then echo "api key:  set"; else echo "api key:  missing"; fi
if [ -n "${HTTPS_PROXY:-}${https_proxy:-}${NODE_USE_ENV_PROXY:-}" ]; then
  echo "proxy:    on"
else
  echo "proxy:    off"
fi
echo "dsh home: ${DSH_SKILLGEN_HOME:-$ROOT/.dsh}"

if [ -z "${DEEPSEEK_API_KEY:-}" ]; then
  echo "DEEPSEEK_API_KEY is missing; source ~/.deepseek_env first" >&2
  exit 1
fi

body=$(mktemp)
code=$(curl -sS --max-time 25 -o "$body" -w '%{http_code}' \
  https://api.deepseek.com/v1/models \
  -H "Authorization: Bearer $DEEPSEEK_API_KEY") || {
  echo "curl failed: network or proxy problem" >&2
  rm -f "$body"
  exit 1
}
echo "api http: $code"
python3 - "$body" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
models = data.get("data", [])
print("models:  " + ", ".join(m.get("id", "?") for m in models[:10]))
PY
rm -f "$body"
