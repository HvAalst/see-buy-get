#!/usr/bin/env bash
# Start, stop, restart or check SeeBuyGet — two ways to run it:
#
#   dev      Node on this machine, hot reload: the backend (:3000) and the apps you name (default: driver), in the
#            background. Logs and pids go to 04_platform/.run/.
#   docker   The Docker stack (docker-compose.yml). Local or cloud is chosen by .env: copy .env.local.example
#            (http://localhost:8080) or .env.cloud.example (production) to .env. See DEPLOY.md.
#
#   scripts/app.sh start   [dev|docker] [app...]
#   scripts/app.sh stop    [dev|docker]
#   scripts/app.sh restart [dev|docker] [app...]
#   scripts/app.sh status  [dev|docker]
#   scripts/app.sh logs    [dev|docker] [backend|<app>|api|web]
#   scripts/app.sh seed    [dev|docker]          demo data + the sign-in sheet (never in production)
#
# The mode defaults to dev. Apps: home driver agent genesis(/send/) fleet mdp vendor business tower(the console).
# `stop docker` never removes the data volume.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN="$ROOT/.run"
API_PORT=3000
APPS="home driver agent genesis fleet mdp vendor business tower"

say() { printf '%s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }
label() { printf '%-9s ' "$1"; }

# The dev port and path of each app, as vite.config.ts has them.
app_port() {
  case "$1" in
    home) echo 5180 ;; driver) echo 5173 ;; agent) echo 5175 ;; genesis) echo 5176 ;; fleet) echo 5177 ;;
    mdp) echo 5178 ;; vendor) echo 5179 ;; tower) echo 5181 ;; business) echo 5182 ;;
    *) die "unknown app '$1' — have: $APPS" ;;
  esac
}
app_path() {
  case "$1" in home|tower) echo / ;; genesis) echo /send/ ;; *) echo "/$1/" ;; esac
}

# WINDOWS (Git Bash) has neither lsof nor pgrep, so `start` saw no app come up and `stop` found nothing to stop. There,
# Windows' own netstat, taskkill and tasklist stand in. Nothing changes where lsof exists (a Mac, the server).
windows() { ! command -v lsof >/dev/null 2>&1 && command -v netstat >/dev/null 2>&1 && command -v taskkill >/dev/null 2>&1; }

listening() {
  if windows; then
    # The process listening on this port: a TCP row whose local address ends in the port and whose foreign address is
    # empty (0.0.0.0:0 or [::]:0). Read by the addresses, not the state column, which Windows translates.
    netstat -ano 2>/dev/null | tr -d '\r' | awk -v p=":$1" '$1 == "TCP" && substr($2, length($2) - length(p) + 1) == p && $3 ~ /^(0\.0\.0\.0|\[::\]):0$/ { print $NF; exit }'
    return 0
  fi
  lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | head -1 || true
}
port_up() { [ -n "$(listening "$1")" ]; }
api_up() { curl -sf -o /dev/null "http://localhost:$API_PORT/v1/health"; }

# Kill a process and everything it started (npm → sh → nest/vite), children first.
kill_tree() {
  local pid=$1 child win
  if windows; then
    # A pid this script wrote ($!) is Git Bash's own; Windows knows the process by another number, kept in /proc.
    win=$(cat "/proc/$pid/winpid" 2>/dev/null || echo "$pid")
    taskkill //T //F //PID "$win" >/dev/null 2>&1 || true
    kill -TERM "$pid" 2>/dev/null || true
    return 0
  fi
  for child in $(pgrep -P "$pid" 2>/dev/null || true); do kill_tree "$child"; done
  kill -TERM "$pid" 2>/dev/null || true
}

# Is the process holding one of our ports ours (node: nest, vite) rather than Docker's?
ours() {
  if windows; then
    tasklist //FI "PID eq $1" //FO CSV //NH 2>/dev/null | grep -qi '"node.exe"'
    return
  fi
  ps -o command= -p "$1" | grep -qE 'node|nest|vite' && ! ps -o command= -p "$1" | grep -q docker
}

# wait_for <seconds> <command...> — the command is run again each second until it succeeds.
wait_for() {
  local secs=$1 i; shift
  for ((i = 0; i < secs; i++)); do
    "$@" && return 0
    sleep 1
  done
  return 1
}

ensure_deps() {
  local dir
  for dir in backend frontend; do
    if [ ! -d "$ROOT/$dir/node_modules" ]; then
      say "installing $dir dependencies (first run)…"
      npm --prefix "$ROOT/$dir" ci --no-audit --no-fund >/dev/null
    fi
  done
}

# ---------------------------------------------------------------------------------------------------------------- dev

dev_start() {
  local apps=("$@") a port
  [ ${#apps[@]} -eq 0 ] && apps=(driver)
  for a in "${apps[@]}"; do app_port "$a" >/dev/null; done
  mkdir -p "$RUN"

  if api_up; then
    label backend; say "already up  http://localhost:$API_PORT/v1"
  else
    port_up $API_PORT && die "port $API_PORT is taken by something that is not a healthy backend (pid $(listening $API_PORT)) — is the Docker stack running? scripts/app.sh stop docker"
    ensure_deps
    nohup npm --prefix "$ROOT/backend" run start:dev >"$RUN/backend.log" 2>&1 &
    echo $! >"$RUN/backend.pid"
    label backend; printf 'starting… '
    wait_for 120 api_up || { say "did not come up in 2 minutes — last lines of .run/backend.log:"; tail -20 "$RUN/backend.log"; exit 1; }
    say "up  http://localhost:$API_PORT/v1  (contract: /v1/docs)"
  fi

  ensure_deps
  for a in "${apps[@]}"; do
    port=$(app_port "$a")
    label "$a"
    if port_up "$port"; then say "already up  http://localhost:$port$(app_path "$a")"; continue; fi
    SBG_APP="$a" nohup npm --prefix "$ROOT/frontend" run dev >"$RUN/$a.log" 2>&1 &
    echo $! >"$RUN/$a.pid"
    if wait_for 60 port_up "$port"; then
      say "up          http://localhost:$port$(app_path "$a")"
    else
      say "did not come up — last lines of .run/$a.log:"; tail -20 "$RUN/$a.log"; exit 1
    fi
  done
}

dev_stop() {
  local f stopped=0 port pid
  shopt -s nullglob
  for f in "$RUN"/*.pid; do
    kill_tree "$(cat "$f")"
    rm -f "$f"
    label "$(basename "$f" .pid)"; say "stopped"; stopped=1
  done
  # Anything still holding our ports that is ours (started by hand, or its pid file lost) — never Docker's.
  for port in $API_PORT 5173 5175 5176 5177 5178 5179 5180 5181 5182; do
    pid=$(listening "$port")
    if [ -n "$pid" ] && ours "$pid"; then
      kill_tree "$pid"; label ":$port"; say "stopped (pid $pid)"; stopped=1
    fi
  done
  [ $stopped -eq 0 ] && say "nothing was running"
  return 0
}

dev_status() {
  local a port any=0
  label backend; if api_up; then say "up    http://localhost:$API_PORT/v1"; else say "down"; fi
  for a in $APPS; do
    port=$(app_port "$a")
    if port_up "$port"; then label "$a"; say "up    http://localhost:$port$(app_path "$a")"; any=1; fi
  done
  [ $any -eq 0 ] && { label apps; say "none running"; }
  return 0
}

dev_logs() {
  local f="$RUN/${1:-backend}.log"
  [ -f "$f" ] || die "no log at .run/${1:-backend}.log"
  tail -50 "$f"
}

# ------------------------------------------------------------------------------------------------------------- docker

compose() { (cd "$ROOT" && docker compose "$@"); }
env_value() { sed -n "s/^$1=//p" "$ROOT/.env" | tail -1; }
is_cloud() { env_value COMPOSE_FILE | grep -q cloud; }

docker_check() {
  [ -f "$ROOT/.env" ] || die "no 04_platform/.env — copy .env.local.example (laptop) or .env.cloud.example (server) to .env"
  docker info >/dev/null 2>&1 || die "Docker is not running"
}

api_healthy() { [ "$(docker inspect -f '{{.State.Health.Status}}' "$(compose ps -q api)" 2>/dev/null)" = healthy ]; }

docker_start() {
  docker_check
  if ! is_cloud && api_up && ! compose ps -q api | grep -q .; then
    die "port $API_PORT is taken by the dev backend — scripts/app.sh stop dev"
  fi
  compose up -d --build
  label api; printf 'starting… '
  wait_for 120 api_healthy || { say "not healthy — last lines of its log:"; compose logs --tail 30 api; exit 1; }
  say "healthy"
  docker_urls
}

docker_urls() {
  label site; say "$(env_value SBG_PUBLIC_URL)"
  label console; say "$(env_value SBG_CONSOLE_URL)"
  is_cloud || { label api; say "http://localhost:$API_PORT/v1  (contract: /v1/docs)"; }
}

docker_seed() {
  docker_check
  is_cloud && die "this .env is the cloud (production) stack: demo data is never seeded there"
  api_healthy || die "the api container is not up — scripts/app.sh start docker"
  compose exec api node scripts/seed-demo.mjs
}

# --------------------------------------------------------------------------------------------------------------- main

case "${1:-}" in
  start|stop|restart|status|logs|seed) cmd=$1; shift ;;
  *) sed -n '2,18p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
mode=dev
case "${1:-}" in dev|docker) mode=$1; shift ;; esac

case "$mode:$cmd" in
  dev:start)      dev_start "$@" ;;
  dev:stop)       dev_stop ;;
  dev:restart)    dev_stop; sleep 1; dev_start "$@" ;;
  dev:status)     dev_status ;;
  dev:logs)       dev_logs "$@" ;;
  dev:seed)       api_up || die "the backend is not up — scripts/app.sh start dev"; npm --prefix "$ROOT/backend" run seed:demo ;;
  docker:start)   docker_start ;;
  docker:stop)    docker_check; compose down ;;   # never -v: the db-data and api-data volumes are the business
  docker:restart) docker_check; compose restart; wait_for 120 api_healthy || true; compose ps ;;
  docker:status)  docker_check; compose ps; docker_urls ;;
  docker:logs)    docker_check; compose logs --tail 50 "$@" ;;
  docker:seed)    docker_seed ;;
esac
