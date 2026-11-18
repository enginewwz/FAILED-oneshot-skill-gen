#!/usr/bin/env bash
# Launch the isolated dsh dev instance; no daemon, no rc-file changes.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DSH_DIR="${DSH_SKILLGEN_HOME:-$ROOT/.dsh}"
PORT="${DSH_SKILLGEN_PORT:-3081}"

command -v dsh >/dev/null 2>&1 || { echo "dsh not found in PATH" >&2; exit 1; }

# Do not inherit the caller's session/profile identity.
unset DSH_SESSION_ID DSH_PROFILE DSH_PROFILE_DIR DSH_WEB_URL DSH_SHELL
export DSH_HOME="$DSH_DIR"

# The isolated home has no stored credential; reuse the user's key file.
if [ -z "${DEEPSEEK_API_KEY:-}" ] && [ -r "$HOME/.deepseek_env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$HOME/.deepseek_env"
  set +a
fi
if [ -z "${DEEPSEEK_API_KEY:-}" ]; then
  echo "warning: DEEPSEEK_API_KEY is not set; model calls will fail" >&2
fi

# First run: materialize the isolated web profile from the shipped template.
if [ ! -f "$DSH_HOME/profiles/web/package.json" ]; then
  echo "initializing profile: $DSH_HOME/profiles/web" >&2
  dsh --profile web --dump-config >/dev/null
fi

PATCH="${DSH_SKILLGEN_PATCH:-$DSH_HOME/skill-gen/dev.patch.yml}"
if [ -n "$PATCH" ]; then
  case "$PATCH" in
    /*) ;;
    *) PATCH="$ROOT/$PATCH" ;;
  esac
fi
ARGS=(--profile web)
if [ -n "$PATCH" ] && [ -f "$PATCH" ]; then
  ARGS+=(--patch "$PATCH")
fi
ARGS+=(--port "$PORT")
if [ "${DSH_SKILLGEN_OPEN:-0}" != "1" ]; then
  ARGS+=(--no-open)
fi

echo "dsh home: $DSH_HOME"
echo "port:     $PORT"
if [ -n "${DEEPSEEK_API_KEY:-}" ]; then echo "api key:  set"; else echo "api key:  missing"; fi
if [ -n "${HTTPS_PROXY:-}${https_proxy:-}${NODE_USE_ENV_PROXY:-}" ]; then
  echo "proxy:    on"
else
  echo "proxy:    off (API timeout? export HTTPS_PROXY / NODE_USE_ENV_PROXY)"
fi
if [ -n "$PATCH" ] && [ -f "$PATCH" ]; then echo "patch:    $PATCH"; fi

cd "$ROOT"
exec dsh "${ARGS[@]}" "$@"
