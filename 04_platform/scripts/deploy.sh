#!/usr/bin/env bash
#
# Puts one release of SeeBuyGet on this server, or takes the last one back. The deploy workflow
# (.github/workflows/deploy.yml) runs it over SSH; by hand it shows what is running, or goes back one release.
#
#   ./deploy.sh <release>     a release is a commit id: its two images were built and pushed by the deploy workflow
#   ./deploy.sh --rollback    back to the release that ran before this one
#   ./deploy.sh --status      what is running
#
# It lives in /opt/seebuyget beside docker-compose.yml, docker-compose.cloud.yml and .env.cloud.example — the
# workflow copies all four at every release — and the server's own files:
#   .env        the server's settings and secrets (DEPLOY.md). The first release makes it from .env.cloud.example.
#               After that this script only ever FILLS IN what is empty — a secret the release needs, the registry —
#               and never changes a value that is there. It is sent nowhere. KEEP A COPY: see DEPLOY.md.
#   RELEASE     which release is running, and which ran before it.
#   backups/    the data as it stood just before each release that restarted the API.
#
# Told by the workflow, each time:
#   IMAGE_REPO                          where the images are, e.g. ghcr.io/owner/repo
#   SBG_PUBLIC_URL, SBG_CONSOLE_URL     the two addresses — written into .env only where it has none yet
#   SBG_REDIRECT_HOSTS, CONSOLE_ALLOW_IPS   optional, the same way
#
# Everything that can refuse a release is asked before anything is changed.

set -euo pipefail
umask 077
cd "$(dirname "$(readlink -f "$0")")"

DATA_VOLUME=seebuyget_api-data # the compose project's name (docker-compose.yml), then the volume's
KEEP_BACKUPS=7
WAIT_SECONDS=180

say() { printf '\n== %s\n' "$*"; }
die() { printf '\nNOT DEPLOYED: %s\n' "$*" >&2; exit 1; }

image_id() { docker image inspect --format '{{.Id}}' "$1" 2>/dev/null || true; }
# The address a web image's apps were built to call: see ../frontend/Dockerfile.
built_for() { tidy "$(docker image inspect --format '{{ index .Config.Labels "com.seebuyget.public-url" }}' "$1" 2>/dev/null || true)"; }
recorded() { if [[ -f RELEASE ]]; then sed -n "s/^$1=//p" RELEASE; fi; }
record() { printf 'current=%s\nprevious=%s\n' "$1" "$2" > RELEASE.tmp && mv RELEASE.tmp RELEASE; }
# An address as every part of this agrees to write it: no slash on the end.
tidy() { local u="$1"; while [[ "$u" == */ ]]; do u="${u%/}"; done; printf '%s' "$u"; }

# A setting as .env has it: the last assignment wins, as it does for Compose; quotes around it are not part of it,
# nor is the carriage return a file edited on Windows ends each line with.
setting() {
  if [[ -f .env ]]; then
    tr -d '\r' < .env | sed -n "s/^$1=//p" | tail -n 1 | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"
  fi
}
# What a setting will be once filled in: .env's own value where it has one, otherwise what was offered.
settled() { local have; have="$(setting "$1")"; printf '%s' "${have:-$2}"; }
# Fill in a setting that .env has no value for. A line `NAME=` with nothing after it is filled where it stands;
# a missing one is added at the end. A value that is there is never touched. Written whole and then moved into
# place, so a failure half way leaves the old file, not half of one.
fill() {
  local name="$1" value="$2"
  [[ -n "$value" && -z "$(setting "$name")" ]] || return 0
  # Lines are written back without a carriage return: the same settings, in the form Compose and this script read.
  if tr -d '\r' < .env | grep -q "^$name=$"; then
    awk -v n="$name" -v v="$value" '{ sub(/\r$/, "") } !done && $0 == n "=" { print n "=" v; done = 1; next } { print }' .env > .env.tmp
  else
    { tr -d '\r' < .env; printf '%s=%s\n' "$name" "$value"; } > .env.tmp
  fi
  mv .env.tmp .env
}

# The data, as one file, taken while nothing is writing it.
snapshot() { # label
  docker volume inspect "$DATA_VOLUME" >/dev/null 2>&1 || return 0 # a first release: there is nothing yet
  local name
  name="data-$(date -u +%Y%m%dT%H%M%SZ)-before-$1.tgz"
  mkdir -p backups
  docker run --rm --user 0 --entrypoint tar \
    -v "$DATA_VOLUME:/data:ro" -v "$PWD/backups:/backups" \
    "$API:current" -czf "/backups/$name" -C /data .
  echo "the data as it stood: backups/$name"
  # The newest few are kept. They are on this disk, so they answer a release that went wrong — not a disk that did.
  ls -1t backups/data-*.tgz | tail -n +$((KEEP_BACKUPS + 1)) | xargs -r rm -f --
}

# Never builds and never pulls: the images are the ones this script fetched and named `current`.
up() { docker compose up --detach --remove-orphans --no-build --pull never --wait --wait-timeout "$WAIT_SECONDS"; }

show_failure() {
  docker compose ps --all || true
  docker compose logs --tail 60 api web || true
}

exec 9> .deploy.lock
flock -n 9 || die "another release is being put on this server right now"

[[ -f docker-compose.yml && -f docker-compose.cloud.yml ]] || die "docker-compose.yml and docker-compose.cloud.yml are not here beside this script"

case "${1:-}" in
  --status | --rollback)
    [[ -f .env ]] || die "this server has had no release yet (there is no .env)"
    REGISTRY="$(setting REGISTRY)"
    [[ -n "$REGISTRY" ]] || die ".env names no REGISTRY: this server was not set up by a release from GitHub"
    API="$REGISTRY/api"; WEB="$REGISTRY/web"
    ;;
esac

case "${1:-}" in
  --status)
    echo "current:  $(recorded current)"
    echo "previous: $(recorded previous)"
    docker compose ps
    exit 0
    ;;

  --rollback)
    now="$(recorded current)"; before="$(recorded previous)"
    [[ -n "$before" && -n "$(image_id "$API:previous")" && -n "$(image_id "$WEB:previous")" ]] || die "there is no release before this one on this server"
    here="$(tidy "$(setting SBG_PUBLIC_URL)")"
    [[ "$(built_for "$WEB:previous")" == "$here" ]] || die "the release before this one was built for '$(built_for "$WEB:previous")', and this server is now $here. Its apps would call the old address."
    say "Going back from ${now:-?} to ${before:-?}"
    if [[ "$(image_id "$API:previous")" != "$(image_id "$API:current")" ]]; then
      docker compose stop api
      snapshot "rollback-from-${now:0:12}"
    fi
    for name in "$API" "$WEB"; do
      docker tag "$name:current" "$name:undone"
      docker tag "$name:previous" "$name:current"
      docker tag "$name:undone" "$name:previous"
      docker rmi "$name:undone" >/dev/null
    done
    up || { show_failure; die "the release before this one did not come up either: look at the output above. ($now is now kept as the one to go back to.)"; }
    record "$before" "$now"
    say "Running ${before:-the release before}. The DATA was not taken back: what the newer release wrote is still there, and the snapshot above is how it stood."
    exit 0
    ;;

  "" | -*)
    die "say which release: ./deploy.sh <commit id>, or --rollback, or --status"
    ;;
esac

RELEASE="$1"
[[ "$RELEASE" =~ ^[0-9a-f]{7,40}$ ]] || die "'$RELEASE' is not a commit id"
[[ -n "${IMAGE_REPO:-}" ]] || die "IMAGE_REPO is not set (where the images are, e.g. ghcr.io/owner/repo)"
API="$IMAGE_REPO/api"; WEB="$IMAGE_REPO/web"
[[ -f .env || -f .env.cloud.example ]] || die "there is neither a .env nor the .env.cloud.example to make one from"

# --- 1. The settings this release will run with: decided here, written in step 4 --------------------------------
registry="$(settled REGISTRY "$IMAGE_REPO")"
[[ "$registry" == "$IMAGE_REPO" ]] || die ".env says REGISTRY=$registry, and this release's images are in $IMAGE_REPO. Releases from GitHub run the images they fetched: take REGISTRY out of .env, or set it to $IMAGE_REPO."
tag="$(settled TAG current)"
[[ "$tag" == current ]] || die ".env says TAG=$tag. Releases from GitHub run the image they put on, which is called 'current': take TAG out of .env, or set it to current."
public="$(tidy "$(settled SBG_PUBLIC_URL "$(tidy "${SBG_PUBLIC_URL:-}")")")"
console="$(tidy "$(settled SBG_CONSOLE_URL "$(tidy "${SBG_CONSOLE_URL:-}")")")"
also="$(settled SBG_REDIRECT_HOSTS "${SBG_REDIRECT_HOSTS:-}")"
allow="$(settled CONSOLE_ALLOW_IPS "${CONSOLE_ALLOW_IPS:-}")"
edge="$(settled CADDY_EDGE direct)"

address='^https?://[A-Za-z0-9.-]+(:[0-9]+)?$'
[[ "$public" =~ $address ]] || die "SBG_PUBLIC_URL must be the site's address and nothing after it, like https://example.com — it is '$public'"
[[ "$console" =~ $address ]] || die "SBG_CONSOLE_URL must be the console's address and nothing after it, like https://ops.example.com — it is '$console'"
[[ "$public" != "$console" ]] || die "the console has an address of its own: SBG_CONSOLE_URL is the same as SBG_PUBLIC_URL"
# Checked here because the web server would refuse to start on a list it cannot read.
[[ -z "$allow" || "$allow" =~ ^[0-9A-Fa-f.:/\ ]+$ ]] || die "CONSOLE_ALLOW_IPS is addresses or ranges with spaces between, like '203.0.113.7 198.51.100.0/24' — it is '$allow'"
[[ -z "$also" || "$also" =~ ^[A-Za-z0-9.-]+(\ [A-Za-z0-9.-]+)*$ ]] || die "SBG_REDIRECT_HOSTS is names with spaces between and nothing else, like 'www.example.com' — it is '$also'"
# A name that is sent on to the site cannot also BE the site, or the console: it would be sent round for ever.
for name in $also; do
  [[ "$public" != *"://$name" && "$console" != *"://$name" ]] || die "SBG_REDIRECT_HOSTS names '$name', which is the address of the site or of the console itself"
done
case "$edge" in
  direct) ;;
  cloudflare)
    [[ -n "$(setting CLOUDFLARE_API_TOKEN)" ]] || die "CADDY_EDGE=cloudflare, and .env has no CLOUDFLARE_API_TOKEN: no certificate could be obtained (DEPLOY.md, 'Behind Cloudflare')"
    [[ -z "$also" ]] || die "behind Cloudflare, www is sent on by Cloudflare's own redirect rule: leave SBG_REDIRECT_HOSTS empty in .env (DEPLOY.md)"
    ;;
  *) die "CADDY_EDGE is 'direct' or 'cloudflare' — .env says '$edge'" ;;
esac

# --- 2. The images ----------------------------------------------------------------------------------------------
say "Fetching release $RELEASE"
docker pull --quiet "$API:$RELEASE" || die "could not fetch $API:$RELEASE — was it built, and is this server signed in to the registry (docker login)?"
docker pull --quiet "$WEB:$RELEASE" || die "could not fetch $WEB:$RELEASE"

# THE APPS CARRY THE ADDRESS THEY CALL, built in. An image built for one address, put on a server that answers at
# another, serves apps that talk to somewhere else — and looks exactly like a working site until somebody signs in.
made_for="$(built_for "$WEB:$RELEASE")"
[[ "$made_for" == "$public" ]] || die "the web image was built for '${made_for:-nothing}', and this server is $public (SBG_PUBLIC_URL in its .env). The repository's variable and the server's .env have to say the same address."

# --- 3. The secrets ---------------------------------------------------------------------------------------------
# Which secrets the server will not start without is asked of the release itself (src/foundation/runtime/secrets.ts),
# not written here a second time: a release that needs a new one gets it made, and this list cannot fall behind.
wanted="$(docker run --rm --entrypoint node "$API:$RELEASE" -e \
  "process.stdout.write(Object.keys(require('./dist/foundation/runtime/secrets').DEPLOYMENT_SECRETS).join(' '))")"
[[ -n "$wanted" ]] || die "the release did not say which secrets it needs"
for name in $wanted; do
  [[ "$name" =~ ^[A-Z][A-Z0-9_]*$ ]] || die "the release named a secret that is not a name: '$name'"
done

# --- 4. The settings, written: filled in where empty, never changed --------------------------------------------
if [[ ! -f .env ]]; then
  cp .env.cloud.example .env
  say "Made .env from .env.cloud.example"
fi
chmod 600 .env
fill COMPOSE_PATH_SEPARATOR :
fill COMPOSE_FILE docker-compose.yml:docker-compose.cloud.yml
fill REGISTRY "$IMAGE_REPO"
fill TAG current
fill SBG_PUBLIC_URL "$public"
fill SBG_CONSOLE_URL "$console"
fill SBG_REDIRECT_HOSTS "$also"
fill CONSOLE_ALLOW_IPS "$allow"
fill CADDY_EDGE "$edge"
made=()
# GLOS_CLIENT_SECRET is the console's setup key: without it, outside a sandbox, the first staff account cannot be made.
for name in $wanted GLOS_CLIENT_SECRET; do
  if [[ -z "$(setting "$name")" ]]; then
    fill "$name" "$(openssl rand -hex 32)"
    made+=("$name")
  fi
done
chmod 600 .env
if (( ${#made[@]} )); then
  say "MADE ON THIS SERVER, JUST NOW: ${made[*]}"
  echo "They are in $PWD/.env and nowhere else. Copy that file somewhere safe today (DEPLOY.md)."
fi

# --- 5. The change ----------------------------------------------------------------------------------------------
before="$(recorded current)"

if [[ "$(image_id "$API:$RELEASE")" != "$(image_id "$API:current")" && -n "$(image_id "$API:current")" ]]; then
  say "Stopping the API and keeping the data as it stands"
  docker compose stop api
  snapshot "${RELEASE:0:12}"
fi

# `previous` is the pair that ran as the release before this one. The same release put on again (a rebuild, a second
# try) is not a new release, and must not make the one before it unreachable. Nor must a release that fails: what
# `previous` was is held until this one is up, and handed back if it is not.
if [[ "$RELEASE" != "$before" ]]; then
  for name in "$API" "$WEB"; do
    docker rmi "$name:held" >/dev/null 2>&1 || true
    if [[ -n "$(image_id "$name:previous")" ]]; then docker tag "$name:previous" "$name:held"; fi
    if [[ -n "$(image_id "$name:current")" ]]; then docker tag "$name:current" "$name:previous"; fi
  done
fi
docker tag "$API:$RELEASE" "$API:current"
docker tag "$WEB:$RELEASE" "$WEB:current"

say "Starting release $RELEASE"
if ! up; then
  show_failure
  # A release that did not start is not kept under its own name: it would stay on the disk for good.
  docker rmi "$API:$RELEASE" "$WEB:$RELEASE" >/dev/null 2>&1 || true
  if [[ -n "$before" && "$RELEASE" != "$before" && -n "$(image_id "$API:previous")" && -n "$(image_id "$WEB:previous")" ]]; then
    say "It did not come up. Putting $before back."
    for name in "$API" "$WEB"; do
      docker tag "$name:previous" "$name:current"
      if [[ -n "$(image_id "$name:held")" ]]; then
        docker tag "$name:held" "$name:previous"
      else
        docker rmi "$name:previous" >/dev/null # there was no release before the one put back
      fi
      docker rmi "$name:held" >/dev/null 2>&1 || true
    done
    up || die "release $RELEASE did not come up, and neither did $before when it was put back. The server is DOWN: look at the output above."
    die "release $RELEASE did not come up; $before is running again. The data is as the failed release left it — the snapshot above is how it stood before."
  fi
  die "release $RELEASE did not come up, and there is no release before it to put back. Look at the output above."
fi
docker rmi "$API:held" "$WEB:held" >/dev/null 2>&1 || true

if [[ "$RELEASE" != "$before" ]]; then record "$RELEASE" "${before:-}"; fi
# Kept under the names this server uses (current, previous); the release's own name, and everything older, can go.
docker rmi "$API:$RELEASE" "$WEB:$RELEASE" >/dev/null 2>&1 || true
docker image prune --force >/dev/null 2>&1 || true

say "Release $RELEASE is running at $public"
docker compose ps
