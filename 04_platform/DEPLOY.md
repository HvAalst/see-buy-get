# Running and deploying SeeBuyGet with Docker

One Compose stack, two containers, the same on a laptop and on a server. `.env` decides which:

| | Laptop | Server (DigitalOcean Droplet) |
|---|---|---|
| Settings | `cp .env.local.example .env` | `cp .env.cloud.example .env`, then fill it in |
| Compose files | `docker-compose.yml` + `docker-compose.local.yml` | `docker-compose.yml` + `docker-compose.cloud.yml` |
| Public site | http://localhost:8080 | https://`your domain` (Let's Encrypt, automatic) |
| Operator console | http://localhost:8081 | https://`console domain` (optional IP allow-list) |
| API | under `/v1` on the site, and http://localhost:3000 | under `/v1` on the site only |
| API mode | sandbox: no secrets, codes on screen, `/v1/docs`, demo data | production: every secret required |

`.env` selects the second Compose file with `COMPOSE_FILE`, so the commands are the same everywhere:

```bash
cd 04_platform
docker compose up -d --build      # start (builds what changed)
docker compose ps                 # status
docker compose logs -f api        # logs
docker compose restart            # restart
docker compose down               # stop; the data volume stays
```

The same commands are wrapped in [`scripts/app.sh`](scripts/app.sh) (`start|stop|restart|status|logs|seed docker`).
That script also runs the plain-Node dev mode, and in Claude Code it backs `/start`, `/stop` and `/restart`.

```
                 ┌──────────────────────────────────────────────────────────┐
  SBG_PUBLIC ───►│ web (Caddy)                                              │
  _URL           │   /            front door, town pages, help.html         │
                 │   /driver/ /agent/ /send/ /fleet/ /mdp/ /vendor/         │
                 │   /business/   the apps (each falls back to its shell)   │
                 │   /v1/*  ─────────────────► api (NestJS) :3000           │
  SBG_CONSOLE ──►│   the operator console          │                        │
  _URL           │                                 ▼                        │
                 │                           volume api-data → /data        │
                 └──────────────────────────────────────────────────────────┘
```

| File | What it is |
|---|---|
| [`docker-compose.yml`](docker-compose.yml) | What both share: the two services and the volumes |
| [`docker-compose.local.yml`](docker-compose.local.yml) / [`docker-compose.cloud.yml`](docker-compose.cloud.yml) | Ports and API mode for each place; the cloud adds log rotation |
| [`backend/Dockerfile`](backend/Dockerfile) | The API: production unless told otherwise, runs as `node`, health-checked on `/v1/health` |
| [`frontend/Dockerfile`](frontend/Dockerfile) | Builds every app for one address, then serves them with Caddy. Built from the repo root (it ships `help.html`) |
| [`frontend/Caddyfile`](frontend/Caddyfile) | Routing, caching, HTTPS for an `https://` address, the console's allow-list |

**What must not be lost:** the `api-data` volume. The API keeps sign-ins, wallets, prepaid balances, the identity
vault and uploaded media there as files. It is a single instance by design: never run more than one `api`
container.

**The site's address is part of the web image.** The apps call the API at `SBG_PUBLIC_URL`/v1, and that address is
baked in at build time. A web image built for the laptop does not work on the server, and the other way round:
build it where it runs, or with that place's `.env`.

## On a laptop

```bash
cd 04_platform
cp .env.local.example .env
docker compose up -d --build
docker compose exec api node scripts/seed-demo.mjs     # demo data + the sign-in sheet
```

Ports 3000, 8080 and 8081 are on 127.0.0.1 only. The dev mode (`scripts/app.sh start dev`) also uses port 3000,
so run one or the other.

## On a DigitalOcean Droplet

**1. A Droplet.** Ubuntu 24.04 with Docker (the "Docker" image in the Marketplace has it installed), **2 GB RAM or
more**: the web image builds eight apps, which a 1 GB Droplet runs out of memory on. Add an SSH key.

**2. A firewall** (Networking → Firewalls): inbound TCP 22, 80, 443 and UDP 443 (HTTP/3). Nothing else. The API's
port is not published, so it needs no rule.

**3. DNS.** Two A records pointing at the Droplet's IP, for the domains in `SBG_PUBLIC_URL` (e.g. `seebuyget.com`)
and `SBG_CONSOLE_URL` (e.g. `ops.seebuyget.com`). Do this first: Caddy asks for certificates on its first start.

**4. The code and its settings.**

```bash
git clone <this repo> seebuyget && cd seebuyget/04_platform
cp .env.cloud.example .env
for k in GLOS_AUTH_SECRET GLOS_VAULT_KEY GLOS_PHONE_PEPPER GLOS_IDENTITY_PEPPER GLOS_FUNDING_SECRET \
         GLOS_LABEL_KEY GLOS_DISCLOSURE_KEY GLOS_VAPID_PRIVATE GLOS_CLIENT_SECRET; do
  sed -i "s|^$k=.*|$k=$(openssl rand -hex 32)|" .env
done
nano .env          # the two addresses, Twilio, ZeptoMail
chmod 600 .env
```

Keep a copy of `.env` somewhere safe (a password manager). The vault key and the two peppers can never be
changed or regenerated once real data exists: without them, what is stored cannot be read.

**5. Start it.**

```bash
docker compose up -d --build
docker compose ps                 # api: healthy, web: running
docker compose logs -f api        # a missing secret is named here, and the API will not start without it
```

**6. The first member of staff.** Open the console address, use the setup-key link under the sign-in form, and
enter `GLOS_CLIENT_SECRET`. See `frontend/README.md`, "The operator console's entrance".

**7. Rebuild the web image once,** now that the API is live: `docker compose up -d --build web`. The front page's
town pages are fetched from the API while building, and on the very first build there was no API to ask.

### Updating

```bash
cd seebuyget && git pull && cd 04_platform
docker compose up -d --build
```

The API restarts in a few seconds; its data stays in the volume. Rebuild `web` whenever towns change (a nightly
cron of `docker compose up -d --build web` is plenty).

**Building somewhere else** (CI, or a laptop) instead of on the Droplet: with the cloud `.env` (so the web image
gets the server's address), set `REGISTRY` (e.g. a DigitalOcean Container Registry,
`registry.digitalocean.com/<name>`) and `TAG`, then `docker compose build && docker compose push` there, and
`docker compose pull && docker compose up -d` on the Droplet. On an Apple-silicon Mac, build with
`DOCKER_DEFAULT_PLATFORM=linux/amd64` (Droplets are x86).

### Backups

The volume is the business. Turn on Droplet backups (or volume snapshots), and keep a copy off the server too:

```bash
docker run --rm -v seebuyget_api-data:/data -v "$PWD":/out alpine \
  tar czf /out/api-data-$(date +%F).tgz -C /data .
```

Restore by stopping `api` and unpacking into the same volume.

### Worth knowing

- **Behind Cloudflare** (proxied, orange cloud) is not set up here. As it stands Caddy would see only Cloudflare's
  addresses and pass those on, so the API's per-caller limits and the console allow-list would see Cloudflare, not
  the caller. It needs Caddy's `trusted_proxies` set to Cloudflare's ranges, `GLOS_TRUST_PROXY=2`, and Cloudflare
  Access in place of `CONSOLE_ALLOW_IPS`. Until then, keep the DNS records "DNS only" (grey cloud).
- **Logs** rotate at 10 MB × 5 per container. `docker compose logs --since 1h web` for requests.
