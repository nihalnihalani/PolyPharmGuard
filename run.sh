#!/usr/bin/env bash
# PolyPharmGuard — single-command runner.
#
# Boots all four services, waits for health, multiplexes their logs to the
# terminal with per-service prefixes, and tears them down cleanly on Ctrl-C.
#
#   ML scorer   (FastAPI)   :8001  /docs
#   MCP server  (TS, HTTP)  :3000  /health, /mcp
#   A2A agent   (TS)        :8000  /health, /.well-known/agent.json
#   Web app     (Next.js)   :3001  /
#
# Logs land in ./logs/<service>.log (full per-service streams) AND on the
# terminal (interleaved, prefixed). Each HTTP service emits structured
# JSON-per-line logs with a stable reqId header (X-Request-Id) so a single
# user click can be traced web-api → ml-scorer.
#
# Usage:
#   ./run.sh                # boot everything, stream logs (Ctrl-C to stop)
#   ./run.sh --no-tail      # boot in background, return prompt, keep services up
#   ./run.sh --status       # check what's running on the expected ports
#   ./run.sh --stop         # kill anything on the expected ports
#   ./run.sh --logs <reqId> # grep all four service logs for a single trace id
#   ./run.sh --help         # this message
#
# Compatible with macOS default bash 3.2 (no associative arrays).

set -o pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="${REPO_ROOT}/logs"
PID_DIR="${LOG_DIR}/pids"

# Service config — pipe-delimited: name|port|wd|cmd
SERVICES=(
  "ml|8001|${REPO_ROOT}/ml-service|python3 -m uvicorn main:app --host 127.0.0.1 --port 8001"
  "mcp|3000|${REPO_ROOT}|env MCP_TRANSPORT=http MCP_PORT=3000 npx tsx src/mcp-server/index.ts"
  "a2a|8000|${REPO_ROOT}|env A2A_AGENT_PORT=8000 npx tsx src/a2a-agent/index.ts"
  "web|3001|${REPO_ROOT}/web|npm run dev"
)

RESET=$'\033[0m'
RED=$'\033[31m'
BOLD=$'\033[1m'

mkdir -p "${LOG_DIR}" "${PID_DIR}"

#───────────────────────────────────────────────────────────────────────────
# Per-service lookups (case statements — bash 3.2 compatible)
#───────────────────────────────────────────────────────────────────────────

color_for() {
  case "$1" in
    ml)  printf '\033[36m' ;;  # cyan
    mcp) printf '\033[35m' ;;  # magenta
    a2a) printf '\033[33m' ;;  # yellow
    web) printf '\033[32m' ;;  # green
    *)   printf '' ;;
  esac
}

health_url_for() {
  case "$1" in
    ml)  echo "http://127.0.0.1:8001/docs" ;;
    mcp) echo "http://127.0.0.1:3000/health" ;;
    a2a) echo "http://127.0.0.1:8000/health" ;;
    web) echo "http://127.0.0.1:3001/" ;;
    *)   echo "" ;;
  esac
}

#───────────────────────────────────────────────────────────────────────────
# Helpers
#───────────────────────────────────────────────────────────────────────────

usage() { sed -n '2,/^$/p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

die() { printf "%s%s%s\n" "${RED}" "$*" "${RESET}" >&2; exit 1; }

port_pid() {
  # Returns PID(s) listening on the given TCP port (macOS + Linux).
  lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null || true
}

wait_for_url() {
  # Poll a URL until it responds 2xx/3xx or timeout (sec).
  local url="$1" timeout="${2:-30}" started end code
  started=$(date +%s)
  end=$((started + timeout))
  while [ "$(date +%s)" -lt "$end" ]; do
    code=$(curl -sS -o /dev/null -m 2 -w '%{http_code}' "$url" 2>/dev/null || echo 000)
    case "$code" in
      2*|3*) return 0 ;;
    esac
    sleep 0.5
  done
  return 1
}

start_service() {
  local name="$1" port="$2" wd="$3" cmd="$4"
  local logf="${LOG_DIR}/${name}.log"
  local pidf="${PID_DIR}/${name}.pid"
  local color
  color=$(color_for "$name")

  if [ -n "$(port_pid "$port")" ]; then
    printf "  %s%-3s%s skip: port %s already in use (pid %s) — leaving as-is\n" \
      "$color" "$name" "${RESET}" "$port" "$(port_pid "$port" | tr '\n' ' ')"
    echo external > "$pidf"
    return 0
  fi

  printf "  %s%-3s%s starting on :%s — log: logs/%s.log\n" \
    "$color" "$name" "${RESET}" "$port" "$name"

  ( cd "$wd" && exec bash -c "$cmd" ) > "$logf" 2>&1 &
  local pid=$!
  echo "$pid" > "$pidf"
}

stop_service() {
  local name="$1" port="$2"
  local pidf="${PID_DIR}/${name}.pid"
  local pid color
  color=$(color_for "$name")

  if [ -f "$pidf" ]; then
    pid=$(cat "$pidf")
    if [ "$pid" = external ]; then
      printf "  %s%-3s%s skip: was external on :%s, not stopping\n" \
        "$color" "$name" "${RESET}" "$port"
      rm -f "$pidf"
      return 0
    fi
    if kill -0 "$pid" 2>/dev/null; then
      kill -TERM -- -"$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
      sleep 0.3
      kill -KILL -- -"$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
    fi
    rm -f "$pidf"
  fi

  # Belt-and-suspenders: also kill anything still bound to the port
  for p in $(port_pid "$port"); do
    kill -TERM "$p" 2>/dev/null || true
  done
}

wait_for_health() {
  local name="$1" url="$2" color
  color=$(color_for "$name")
  if [ -z "$url" ]; then return 0; fi
  if wait_for_url "$url" 30; then
    printf "  %s%-3s%s ready ✓ %s\n" "$color" "$name" "${RESET}" "$url"
    return 0
  else
    printf "  %s%-3s%s ${RED}HEALTH-CHECK FAILED${RESET} after 30s — last 20 log lines:\n" \
      "$color" "$name" "${RESET}"
    tail -n 20 "${LOG_DIR}/${name}.log" | sed 's/^/      /'
    return 1
  fi
}

cleanup() {
  printf "\n%sShutting down...%s\n" "${BOLD}" "${RESET}"
  for entry in "${SERVICES[@]}"; do
    IFS='|' read -r name port _ _ <<<"$entry"
    stop_service "$name" "$port"
  done
  printf "%sStopped.%s\n" "${BOLD}" "${RESET}"
  exit 0
}

multiplex_tail() {
  printf "\n%sStreaming logs (Ctrl-C to stop all services)%s\n\n" "${BOLD}" "${RESET}"
  for entry in "${SERVICES[@]}"; do
    IFS='|' read -r name _ _ _ <<<"$entry"
    local logf="${LOG_DIR}/${name}.log" color
    color=$(color_for "$name")
    [ -f "$logf" ] || continue
    ( tail -n 0 -F "$logf" 2>/dev/null \
        | awk -v c="$color" -v n="$name" -v r="${RESET}" \
            '{ printf "%s[%-3s]%s %s\n", c, n, r, $0; fflush(); }' ) &
  done
  wait
}

print_summary() {
  echo ""
  printf "%sPolyPharmGuard is up%s\n" "${BOLD}" "${RESET}"
  printf "  ML scorer   →  http://127.0.0.1:8001/docs\n"
  printf "  MCP server  →  http://127.0.0.1:3000/health  (mcp at /mcp)\n"
  printf "  A2A agent   →  http://127.0.0.1:8000/health  (card at /.well-known/agent.json)\n"
  printf "  Web app     →  http://127.0.0.1:3001/\n"
  echo ""
  printf "  Open the demo:  ${BOLD}http://127.0.0.1:3001/batch${RESET}\n"
  echo ""
  printf "  ${BOLD}Active features${RESET}\n"
  printf "    • Review snapshots persisted to data/audit.db (idempotent on reviewId)\n"
  printf "    • SHARP-on-FHIR hydration when X-FHIR-Server-URL header present;\n"
  printf "      synthea fixtures otherwise; 404 for unknown patient IDs\n"
  printf "    • PGx genotypes ingested from FHIR Observations when SHARP context present\n"
  printf "    • Risk-score: 3s timeout, structured 'unavailable' badge on failure\n"
  echo ""
  printf "  ${BOLD}Tunable env (all optional)${RESET}\n"
  printf "    RISK_SCORE_SERVICE_URL    default http://localhost:8001\n"
  printf "    RISK_SCORE_TIMEOUT_MS     default 3000\n"
  printf "    FHIR_REQUEST_TIMEOUT_MS   default 5000\n"
  echo ""
  printf "  ${BOLD}Logs + tracing${RESET}\n"
  printf "    Per-service logs: %s/{ml,mcp,a2a,web}.log\n" "${LOG_DIR}"
  printf "    HTTP logs are JSON-per-line with a stable reqId.\n"
  printf "    Trace one request across services:  ${BOLD}./run.sh --logs <reqId>${RESET}\n"
  printf "    Tail one service:                   tail -f logs/web.log | grep '\"reqId\"'\n"
  echo ""
}

# Grep every service log for a single trace id and print matches in time
# order, prefixed with the colored service name. Useful when investigating a
# specific user click that touched web → ml (or web → mcp/a2a in future).
grep_trace() {
  local reqId="$1"
  if [ -z "$reqId" ]; then
    die "Usage: ./run.sh --logs <reqId>"
  fi
  printf "%sTracing reqId %s%s%s across all service logs%s\n\n" \
    "${BOLD}" "${RED}" "$reqId" "${RESET}${BOLD}" "${RESET}"
  local found_any=false
  for entry in "${SERVICES[@]}"; do
    IFS='|' read -r name _ _ _ <<<"$entry"
    local logf="${LOG_DIR}/${name}.log"
    [ -f "$logf" ] || continue
    local color
    color=$(color_for "$name")
    # Use grep -F for fixed-string match (reqIds aren't regexes); -h to drop
    # the filename prefix since we add our own colored tag.
    local matches
    matches=$(grep -F "$reqId" "$logf" 2>/dev/null || true)
    if [ -n "$matches" ]; then
      found_any=true
      while IFS= read -r line; do
        printf "%s[%-3s]%s %s\n" "$color" "$name" "${RESET}" "$line"
      done <<<"$matches"
    fi
  done
  if [ "$found_any" = false ]; then
    printf "  %sNo matches.%s Either the request id is wrong, the request hasn't\n" "${RED}" "${RESET}"
    printf "  flushed yet, or it was served before the current log files were created.\n"
    exit 1
  fi
}

#───────────────────────────────────────────────────────────────────────────
# Subcommand dispatch
#───────────────────────────────────────────────────────────────────────────

case "${1:-up}" in
  -h|--help|help)
    usage
    exit 0
    ;;
  --status|status)
    printf "%sService status%s\n" "${BOLD}" "${RESET}"
    for entry in "${SERVICES[@]}"; do
      IFS='|' read -r name port _ _ <<<"$entry"
      pid=$(port_pid "$port")
      color=$(color_for "$name")
      if [ -n "$pid" ]; then
        printf "  %s%-3s%s :%s  pid %s\n" "$color" "$name" "${RESET}" "$port" "$(echo "$pid" | tr '\n' ' ')"
      else
        printf "  %s%-3s%s :%s  ${RED}DOWN${RESET}\n" "$color" "$name" "${RESET}" "$port"
      fi
    done
    exit 0
    ;;
  --stop|stop)
    printf "%sStopping services%s\n" "${BOLD}" "${RESET}"
    for entry in "${SERVICES[@]}"; do
      IFS='|' read -r name port _ _ <<<"$entry"
      pid=$(port_pid "$port")
      color=$(color_for "$name")
      if [ -n "$pid" ]; then
        printf "  %s%-3s%s killing pid(s) %son :%s\n" "$color" "$name" "${RESET}" "$(echo "$pid" | tr '\n' ' ')" "$port"
        echo "$pid" | xargs -n1 kill -TERM 2>/dev/null || true
      fi
      rm -f "${PID_DIR}/${name}.pid"
    done
    exit 0
    ;;
  --logs|logs)
    grep_trace "${2:-}"
    exit 0
    ;;
esac

NO_TAIL=false
[ "${1:-}" = "--no-tail" ] && NO_TAIL=true

#───────────────────────────────────────────────────────────────────────────
# Pre-flight
#───────────────────────────────────────────────────────────────────────────

printf "%sPolyPharmGuard runner%s — log dir: %s\n\n" "${BOLD}" "${RESET}" "${LOG_DIR}"

command -v node >/dev/null   || die "node not found on PATH"
command -v python3 >/dev/null || die "python3 not found on PATH"
command -v curl >/dev/null   || die "curl not found on PATH"
command -v lsof >/dev/null   || die "lsof not found on PATH"

[ -d "${REPO_ROOT}/node_modules" ]      || die "Run 'npm install' in repo root first"
[ -d "${REPO_ROOT}/web/node_modules" ]  || die "Run 'npm install' in ./web first"
python3 -c 'import fastapi, uvicorn, pydantic' 2>/dev/null \
  || die "ML deps missing — run 'pip install -r ml-service/requirements.txt'"

# Audit DB writability check. The web review API persists every review
# snapshot here (src/persistence/reviews.ts); if the directory isn't
# writable, the first request fails with a confusing SQLite error rather
# than the clean pre-flight message we surface here.
mkdir -p "${REPO_ROOT}/data" 2>/dev/null || true
if ! ( touch "${REPO_ROOT}/data/.run-sh-write-probe" 2>/dev/null && rm -f "${REPO_ROOT}/data/.run-sh-write-probe" ); then
  die "data/ is not writable — review snapshots and audit log can't persist. Check permissions on ${REPO_ROOT}/data"
fi

trap cleanup INT TERM

#───────────────────────────────────────────────────────────────────────────
# Boot
#───────────────────────────────────────────────────────────────────────────

printf "%sStarting services%s\n" "${BOLD}" "${RESET}"
for entry in "${SERVICES[@]}"; do
  IFS='|' read -r name port wd cmd <<<"$entry"
  start_service "$name" "$port" "$wd" "$cmd"
done

echo ""
printf "%sWaiting for health...%s\n" "${BOLD}" "${RESET}"
all_ok=true
for entry in "${SERVICES[@]}"; do
  IFS='|' read -r name _ _ _ <<<"$entry"
  if ! wait_for_health "$name" "$(health_url_for "$name")"; then
    all_ok=false
  fi
done

if [ "$all_ok" = false ]; then
  printf "\n%s%sOne or more services failed to come up — see logs above.%s\n" "${RED}" "${BOLD}" "${RESET}"
  printf "Use ${BOLD}./run.sh --stop${RESET} to clean up. Tailing logs anyway in case it recovers.\n"
fi

print_summary

if [ "$NO_TAIL" = true ]; then
  printf "%sBackground mode: services left running. Stop with ./run.sh --stop%s\n\n" "${BOLD}" "${RESET}"
  exit 0
fi

multiplex_tail
