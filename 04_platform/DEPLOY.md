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

## On a DigitalOcean Droplet, behind Cloudflare

The chain: the domain is registered at **MijnDomein**, its DNS is run by **Cloudflare** (with the proxy on, the orange
cloud), and Cloudflare sends visitors on to the **Droplet**.

```
visitor ──HTTPS──► Cloudflare (DNS, proxy, cache) ──HTTPS──► Droplet: Caddy ──► api
                    ▲                                         firewall: only Cloudflare may knock
 MijnDomein: nameservers point at Cloudflare
```

With `CADDY_EDGE=cloudflare` (the default in `.env.cloud.example`), Caddy:

- reads the visitor's address from `CF-Connecting-IP`, but only on connections from Cloudflare's own address ranges,
  which it fetches from Cloudflare and keeps current. The API's sign-in limits, the staff network fence and the
  console allow-list therefore see the visitor, not Cloudflare.
- gets its certificates by writing a DNS record through Cloudflare's API. Let's Encrypt cannot reach a server
  behind the proxy, so this is how Cloudflare can talk to the Droplet over HTTPS in "Full (strict)" mode.

To run without Cloudflare's proxy (grey cloud, or another DNS host), set `CADDY_EDGE=direct`.

**1. A Droplet.** Ubuntu 24.04 with Docker (the "Docker" image in the Marketplace has it installed), **2 GB RAM or
more**: the web image builds eight apps, which a 1 GB Droplet runs out of memory on. Add an SSH key. Note its IP.

**2. Cloudflare takes over the domain's DNS.**

1. In Cloudflare, *Add a domain* (the Free plan is enough). It copies the records it finds at MijnDomein.
   Check that every **MX and TXT** record came across (email, SPF, DKIM, site verifications): anything missing stops
   working when the nameservers change.
2. At **MijnDomein**: if DNSSEC is switched on for the domain, switch it **off** first. Otherwise the domain stops
   resolving during the move. Then, in the domain's DNS settings, replace MijnDomein's nameservers with the two
   Cloudflare shows you. It usually takes an hour or two, sometimes up to a day. Cloudflare emails you when the
   domain is active.
3. Once it is active: turn DNSSEC on in Cloudflare (DNS → Settings), and paste the DS record it gives you into
   MijnDomein's DNSSEC settings.

**3. Cloudflare settings.**

| Where | Set |
|---|---|
| DNS → Records | `A` `@` → the Droplet's IP, **Proxied**. `A` `ops` (the console) → the same IP, **Proxied**. Optional: `CNAME` `www` → `@`, Proxied |
| SSL/TLS → Overview | **Full (strict)**. Never "Flexible": that sends the traffic on to the Droplet unencrypted |
| SSL/TLS → Edge Certificates | Always Use HTTPS **on**, Minimum TLS 1.2 |
| Speed → Optimization | Rocket Loader **off**: it rewrites the pages' scripts and breaks the apps |
| Rules → Redirect Rules | if you added `www`: the "Redirect from WWW to root" template |
| My Profile → API Tokens | *Create Token* → template **Edit zone DNS**, zone: your domain only. Goes in `.env` as `CLOUDFLARE_API_TOKEN` |

Record emails (ZeptoMail's DKIM and return-path records, when email is set up) are **DNS only** (grey cloud):
Cloudflare cannot proxy anything but web traffic.

**4. A DigitalOcean firewall that admits only Cloudflare.** Otherwise anybody who learns the Droplet's IP walks
around Cloudflare and its protection. Ports 80/443 accept Cloudflare's ranges only, and SSH accepts your own
address. Outbound must stay open: Caddy talks to Cloudflare and Let's Encrypt, and the API to Twilio and ZeptoMail.
With [`doctl`](https://docs.digitalocean.com/reference/doctl/), from your own machine:

```bash
CF=$( (curl -s https://www.cloudflare.com/ips-v4; echo; curl -s https://www.cloudflare.com/ips-v6) | grep . | sed 's/^/address:/' | paste -sd, -)
doctl compute firewall create --name seebuyget-web --droplet-ids <droplet id> \
  --inbound-rules "protocol:tcp,ports:22,address:<your IP>/32 protocol:tcp,ports:80,$CF protocol:tcp,ports:443,$CF" \
  --outbound-rules "protocol:tcp,ports:all,address:0.0.0.0/0,address:::/0 protocol:udp,ports:all,address:0.0.0.0/0,address:::/0 protocol:icmp,address:0.0.0.0/0,address:::/0"
```

Or the same by hand under Networking → Firewalls. Cloudflare's ranges change rarely: if they do (they announce it),
run `doctl compute firewall update` with the same rules.

**5. The console's gate (recommended): Cloudflare Access.** In Zero Trust → Access → Applications, add a
*self-hosted* application for the console's domain, with a policy listing the staff's email addresses. A stranger
then gets Cloudflare's login page, never ours. It is free for up to 50 users. With it in place, leave
`CONSOLE_ALLOW_IPS` unset.

**6. The code and its settings.**

```bash
git clone <this repo> seebuyget && cd seebuyget/04_platform
cp .env.cloud.example .env
for k in GLOS_AUTH_SECRET GLOS_VAULT_KEY GLOS_PHONE_PEPPER GLOS_IDENTITY_PEPPER GLOS_FUNDING_SECRET \
         GLOS_LABEL_KEY GLOS_DISCLOSURE_KEY GLOS_VAPID_PRIVATE GLOS_CLIENT_SECRET; do
  sed -i "s|^$k=.*|$k=$(openssl rand -hex 32)|" .env
done
nano .env          # the two addresses, CLOUDFLARE_API_TOKEN, Twilio, ZeptoMail
chmod 600 .env
```

Keep a copy of `.env` somewhere safe (a password manager). The vault key and the two peppers can never be
changed or regenerated once real data exists: without them, what is stored cannot be read.

**7. Start it.**

```bash
docker compose up -d --build
docker compose ps                 # api: healthy, web: running
docker compose logs -f api        # a missing secret is named here, and the API will not start without it
docker compose logs -f web        # "certificate obtained successfully" for both domains
```

**8. The first member of staff.** Open the console address, use the setup-key link under the sign-in form, and
enter `GLOS_CLIENT_SECRET`. See `frontend/README.md`, "The operator console's entrance".

**9. Rebuild the web image once,** now that the API is live: `docker compose up -d --build web`. The front page's
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

- **Cloudflare caches** what it may: the apps' fingerprinted files for a year (Caddy says so), and the pages and service
  workers not at all (Caddy says `no-cache`). There is nothing to purge after a deploy.
- **Something wrong only through Cloudflare?** Set the record to DNS only (grey cloud) for a minute and try the site
  directly. Caddy's certificate is a real Let's Encrypt one, so the site works the same either way (the firewall in
  step 4 must let you through for that).
- **Logs** rotate at 10 MB × 5 per container. `docker compose logs --since 1h web` for requests.
