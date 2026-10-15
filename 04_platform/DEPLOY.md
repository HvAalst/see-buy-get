# Running and deploying SeeBuyGet with Docker

One Compose stack, two containers, the same on a laptop and on a server. `.env` decides which:

| | Laptop | Server (DigitalOcean Droplet) |
|---|---|---|
| Settings | `cp .env.local.example .env` | `/opt/seebuyget/.env`, made from `.env.cloud.example` by the first release |
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
  _URL           │                                 │                        │
                 │            volume api-data ◄────┴────► db (Postgres)     │
                 │            (uploaded files)            volume db-data    │
                 └──────────────────────────────────────────────────────────┘
```

| File | What it is |
|---|---|
| [`docker-compose.yml`](docker-compose.yml) | What both share: the three services (web, api, db) and the volumes |
| [`docker-compose.local.yml`](docker-compose.local.yml) / [`docker-compose.cloud.yml`](docker-compose.cloud.yml) | Ports and API mode for each place; the cloud adds log rotation |
| [`backend/Dockerfile`](backend/Dockerfile) | The API: production unless told otherwise, runs as `node`, health-checked on `/v1/health` |
| [`frontend/Dockerfile`](frontend/Dockerfile) | Builds every app for one address, then serves them with Caddy. Built from the repo root (it ships `help.html`) |
| [`frontend/Caddyfile`](frontend/Caddyfile) | Routing, caching, HTTPS for an `https://` address, `www` sent on, the console's allow-list |
| [`scripts/setup-droplet.sh`](scripts/setup-droplet.sh) | Run once on a new Droplet: Docker, the `deploy` user, the firewall |
| [`scripts/deploy.sh`](scripts/deploy.sh) | Puts a release on the server, takes the last one back, says what is running |
| [`../.github/workflows/`](../.github/workflows/) | `ci.yml` tests every pull request; `deploy.yml` tests, builds and releases every push to `main` |

**What must not be lost:** two volumes. `db-data` is Postgres, and holds every record: sign-ins, wallets, prepaid
balances, parcels, loads, the books. `api-data` holds uploaded media and documents as files. The API is a single
instance by design: never run more than one `api` container. Told to stop, it answers what is in hand and writes
what is in memory first (`src/main.ts`); a write is in Postgres before the request that made it is answered.

**Postgres comes with the stack** (`db`, Postgres 16; its port is not published, so only the API reaches it). Its
password is `POSTGRES_PASSWORD` in `.env`: on a laptop a default, on a server its own, made by `scripts/deploy.sh`
on the first release like the other secrets. It must not change once there is data. **A store that ran on files
moves in by itself:** the first time the API starts against an empty Postgres, each collection's file under
`/data` is copied in, in order, and renamed `*.moved-to-postgres` (kept, never copied twice). A release from
before Postgres cannot be rolled back to on a server that has moved: it would read the files, and they have moved.

**The site's address is part of the web image.** The apps call the API at `SBG_PUBLIC_URL`/v1, and that address is
baked in at build time. A web image built for the laptop does not work on the server, and the other way round:
build it where it runs, or with that place's `.env`. The image carries the address it was built for, and
`scripts/deploy.sh` will not start one on a server whose `.env` says another.

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

Two choices, each with a default:

- **What stands in front.** By default nothing: the domain's `A` records point straight at the Droplet, and Caddy
  gets its certificates from Let's Encrypt itself (`CADDY_EDGE=direct`). Or Cloudflare's proxy: see
  "Behind Cloudflare" below.
- **How a release gets there.** By default from GitHub: every push to `main` is tested, built into two images, and
  put on the server by `scripts/deploy.sh`, which puts the old release back if the new one does not start. Or by
  hand, building on the Droplet itself: see "By hand on the Droplet" below.

### Releases from GitHub

**1. A Droplet.** Ubuntu 24.04 LTS, **2 GB RAM or more**, the region nearest the people using it, your own SSH key,
**Backups on**, IPv6 off (this setup answers over IPv4; behind Docker an IPv6 caller would not be seen by its own
address, and the sign-in limits would count all of them together). Note its IP. Nothing is built on it: the images
are built by GitHub.

**2. The names.** At the domain's DNS (MijnDomein: the arrow by the domain → *Beheren* → *DNS instellen*), an `A`
record each, pointing at the Droplet:

| Type | Name | Value |
|---|---|---|
| `A` | `@` (the domain itself) | the Droplet's IP |
| `A` | `www` | the Droplet's IP |
| `A` | `ops` (the console) | the Droplet's IP |

**And delete every `AAAA` record and any wildcard (`*`) record that points elsewhere** — a registrar's parking page
usually has both. Where an `AAAA` record exists, Let's Encrypt checks the name over IPv6 first, reaches the old
address, and issues no certificate. Leave the `TXT` (SPF) and `_dmarc` records; email changes them later.

**3. A key for the deploy** — only for the workflow, not your own. Keep it out of the repository's folder; asked
for a passphrase, press Enter twice (the workflow cannot type one):

```bash
ssh-keygen -t ed25519 -C "seebuyget-deploy" -f ~/.ssh/seebuyget-deploy
```

**4. Make the Droplet ready**, once, from the repository root:

```bash
scp 04_platform/scripts/setup-droplet.sh root@<IP>:
ssh root@<IP> "bash setup-droplet.sh '$(cat ~/.ssh/seebuyget-deploy.pub)'"
```

(PowerShell: the same two lines, with `Get-Content $HOME\.ssh\seebuyget-deploy.pub` in place of `cat …`.) It
installs Docker, makes the `deploy` user the workflow signs in as, opens the firewall for 80, 443 and SSH only,
makes `/opt/seebuyget`, and prints the two values for the next step.

**5. Tell the repository.** GitHub → Settings → Secrets and variables → Actions:

| Kind | Name | Value |
|---|---|---|
| variable | `SBG_PUBLIC_URL` | `https://seebuyget.com` — the site, nothing after the name |
| variable | `SBG_CONSOLE_URL` | `https://ops.seebuyget.com` |
| variable | `SBG_REDIRECT_HOSTS` | `www.seebuyget.com` — names sent on to the site, spaces between |
| variable | `DEPLOY_HOST` | the Droplet's IP — printed by step 4 |
| variable | `DEPLOY_KNOWN_HOSTS` | the server's own key — printed by step 4, the whole line |
| secret | `DEPLOY_SSH_KEY` | the whole of `~/.ssh/seebuyget-deploy` |
| variable (optional) | `CONSOLE_ALLOW_IPS` | the networks staff work on, e.g. `203.0.113.7 198.51.100.0/24` |

Until `DEPLOY_HOST` is set, a push to `main` is tested and nothing more.

**6. The first release.** Actions → Deploy → Run workflow (or push to `main`). The last step asks the site for
`/v1/health` from outside; when it is green, the site is up. That first release makes `/opt/seebuyget/.env` from
`.env.cloud.example`, writes the addresses into it, and **makes every secret the server needs, there, on the
server**. Every later release only fills in what is empty in it — a secret a new release needs — and never changes a
value that is there.

**7. Straight after the first release — three things nobody else can do.**

- **Copy `.env` somewhere safe** (a password manager), then delete the copy from your machine:

  ```bash
  scp deploy@<IP>:/opt/seebuyget/.env seebuyget.env
  ```

  The vault key and the two peppers can never be changed or made again once real data exists: without them, what
  is stored cannot be read — nor can any backup of it.
- **The first member of staff.** Open the console address, use the setup-key link under the sign-in form, and enter
  `GLOS_CLIENT_SECRET` from `.env`. See `frontend/README.md`, "The operator console's entrance".
- **Texts and email.** Until Twilio is in `.env`, nobody can sign up or reset a PIN; staff beyond the first are
  invited by email (ZeptoMail). Fill in those lines of `/opt/seebuyget/.env`, then start the API on them:

  ```bash
  ssh deploy@<IP> "cd /opt/seebuyget && docker compose up -d"
  ```

**Every release** after that: tests, two images to GitHub's container registry, then `scripts/deploy.sh` on the
server — it fetches them, refuses a web image built for another address, copies the data with the API stopped
(`backups/`, the newest seven), starts the release, and **puts the one before back by itself if it does not come
up**. While the API restarts — a few seconds — a call waits for it rather than failing. To make every release wait
for a yes: Settings → Environments → `production` → Required reviewers.

**On the server:**

```bash
ssh deploy@<IP>
cd /opt/seebuyget
./deploy.sh --status              # which release is running, and which ran before
docker compose logs -f api        # what the API is saying
docker compose up -d              # after changing .env: start again on the new values
./deploy.sh --rollback            # back to the release before this one (the code, not the data)
```

An older release: Actions → Deploy → Run workflow, with its full commit id. It is not built again.

**Going back changes the code, not the data.** What the newer release wrote stays written. To put a copy of the
data back (everything since is lost) — the records, then the files:

```bash
cd /opt/seebuyget && docker compose stop api
gunzip -c backups/db-<the file>.sql.gz | docker compose exec -T db psql -U glos -d glos -v ON_ERROR_STOP=1
docker run --rm --user 0 --entrypoint sh -v seebuyget_api-data:/data -v "$PWD/backups:/backups:ro" \
  "$(sed -n 's/^REGISTRY=//p' .env)/api:current" -c 'rm -rf /data/* && tar -xzf /backups/<the file> -C /data && chown -R node:node /data'
docker compose up -d
```

### Behind Cloudflare

The chain: the domain is registered at **MijnDomein**, its DNS is run by **Cloudflare** (with the proxy on, the orange
cloud), and Cloudflare sends visitors on to the **Droplet**.

```
visitor ──HTTPS──► Cloudflare (DNS, proxy, cache) ──HTTPS──► Droplet: Caddy ──► api
                    ▲                                         firewall: only Cloudflare may knock
 MijnDomein: nameservers point at Cloudflare
```

Cloudflare then holds the visitors' connections: it sees the traffic unencrypted, ID photos included. Decide that on
purpose.

With `CADDY_EDGE=cloudflare` in the server's `.env` (and `CLOUDFLARE_API_TOKEN`, and `SBG_REDIRECT_HOSTS` empty:
Cloudflare's own redirect rule sends `www` on), Caddy:

- reads the visitor's address from `CF-Connecting-IP`, but only on connections from Cloudflare's own address ranges,
  which it fetches from Cloudflare and keeps current. The API's sign-in limits, the staff network fence and the
  console allow-list therefore see the visitor, not Cloudflare.
- gets its certificates by writing a DNS record through Cloudflare's API. Let's Encrypt cannot reach a server
  behind the proxy, so this is how Cloudflare can talk to the Droplet over HTTPS in "Full (strict)" mode.

**1. Cloudflare takes over the domain's DNS.**

1. In Cloudflare, *Add a domain* (the Free plan is enough). It copies the records it finds at MijnDomein.
   Check that every **MX and TXT** record came across (email, SPF, DKIM, site verifications): anything missing stops
   working when the nameservers change.
2. At **MijnDomein**: if DNSSEC is switched on for the domain, switch it **off** first. Otherwise the domain stops
   resolving during the move. Then, in the domain's DNS settings, replace MijnDomein's nameservers with the two
   Cloudflare shows you. It usually takes an hour or two, sometimes up to a day. Cloudflare emails you when the
   domain is active.
3. Once it is active: turn DNSSEC on in Cloudflare (DNS → Settings), and paste the DS record it gives you into
   MijnDomein's DNSSEC settings.

**2. Cloudflare settings.**

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

**3. A DigitalOcean firewall that admits only Cloudflare.** Otherwise anybody who learns the Droplet's IP walks
around Cloudflare and its protection. Ports 80/443 accept Cloudflare's ranges only. **SSH:** with releases from
GitHub, the workflow signs in from GitHub's own machines, whose addresses are many and change — so port 22 stays
open, and the deploy key is the only way in (`setup-droplet.sh`). Releasing by hand, SSH can accept your own address
only. Outbound must stay open: Caddy talks to Cloudflare and Let's Encrypt, and the API to Twilio and ZeptoMail.
With [`doctl`](https://docs.digitalocean.com/reference/doctl/), from your own machine:

```bash
CF=$( (curl -s https://www.cloudflare.com/ips-v4; echo; curl -s https://www.cloudflare.com/ips-v6) | grep . | sed 's/^/address:/' | paste -sd, -)
doctl compute firewall create --name seebuyget-web --droplet-ids <droplet id> \
  --inbound-rules "protocol:tcp,ports:22,address:<your IP>/32 protocol:tcp,ports:80,$CF protocol:tcp,ports:443,$CF" \
  --outbound-rules "protocol:tcp,ports:all,address:0.0.0.0/0,address:::/0 protocol:udp,ports:all,address:0.0.0.0/0,address:::/0 protocol:icmp,address:0.0.0.0/0,address:::/0"
```

(For releases from GitHub, make the port 22 rule `address:0.0.0.0/0,address:::/0`.) Or the same by hand under
Networking → Firewalls. Cloudflare's ranges change rarely: if they do (they announce it), run
`doctl compute firewall update` with the same rules.

**4. The console's gate (recommended): Cloudflare Access.** In Zero Trust → Access → Applications, add a
*self-hosted* application for the console's domain, with a policy listing the staff's email addresses. A stranger
then gets Cloudflare's login page, never ours. It is free for up to 50 users. With it in place, leave
`CONSOLE_ALLOW_IPS` unset.

### By hand on the Droplet

Without GitHub: the code is cloned on the Droplet and built there (2 GB RAM or more — the web image builds eight
apps, which a 1 GB Droplet runs out of memory on). The "Docker" image in the Marketplace has Docker installed.

**1. The code and its settings.**

```bash
git clone <this repo> seebuyget && cd seebuyget/04_platform
cp .env.cloud.example .env
# Fills in each secret that is EMPTY. One that is set is left alone, so running this twice changes nothing.
for k in GLOS_AUTH_SECRET GLOS_VAULT_KEY GLOS_PHONE_PEPPER GLOS_IDENTITY_PEPPER GLOS_FUNDING_SECRET \
         GLOS_LABEL_KEY GLOS_DISCLOSURE_KEY GLOS_VAPID_PRIVATE GLOS_CLIENT_SECRET; do
  sed -i "s|^$k=$|$k=$(openssl rand -hex 32)|" .env
done
nano .env          # the two addresses, Twilio, ZeptoMail (and CLOUDFLARE_API_TOKEN behind Cloudflare)
chmod 600 .env
```

Keep a copy of `.env` somewhere safe (a password manager). The vault key and the two peppers can never be
changed or regenerated once real data exists: without them, what is stored cannot be read.

**2. Start it.**

```bash
docker compose up -d --build
docker compose ps                 # api: healthy, web: healthy
docker compose logs -f api        # a missing secret is named here, and the API will not start without it
docker compose logs -f web        # "certificate obtained successfully" for each name
```

**3. The first member of staff**, as in step 7 above.

**4. Rebuild the web image once,** now that the API is live: `docker compose up -d --build web`. The front page's
town pages are fetched from the API while building, and on the very first build there was no API to ask.

**Updating:**

```bash
cd seebuyget && git pull && cd 04_platform
docker compose up -d --build
```

The API restarts in a few seconds; its data stays in the volume. Rebuild `web` whenever towns change (a nightly
cron of `docker compose up -d --build web` is plenty).

**Building somewhere else** (a laptop) instead of on the Droplet: with the cloud `.env` (so the web image gets the
server's address), set `REGISTRY` (e.g. a DigitalOcean Container Registry, `registry.digitalocean.com/<name>`) and
`TAG`, then `docker compose build && docker compose push` there, and `docker compose pull && docker compose up -d`
on the Droplet. On an Apple-silicon Mac, build with `DOCKER_DEFAULT_PLATFORM=linux/amd64` (Droplets are x86).

### Backups

The two volumes are the business. Turn on Droplet backups (or volume snapshots), and keep a copy off the server too —
the records as a Postgres dump (it can be taken while everything runs), and the files:

```bash
docker compose exec -T db pg_dump -U glos -d glos --clean --if-exists | gzip > db-$(date +%F).sql.gz
docker run --rm -v seebuyget_api-data:/data -v "$PWD":/out alpine \
  tar czf /out/api-data-$(date +%F).tgz -C /data .
```

Restore by stopping `api`, feeding the dump to `psql` (`gunzip -c db-….sql.gz | docker compose exec -T db psql -U
glos -d glos`), and unpacking the files into the same volume. Released from GitHub, the server also keeps the data
as it stood before each of the last seven releases that restarted the API, in `/opt/seebuyget/backups/` — on the
same disk, so they answer a release that went wrong, not a disk that did. None of these hold `.env`: keep that
copy yourself (step 7).

### Worth knowing

- **Cloudflare caches** what it may: the apps' fingerprinted files for a year (Caddy says so), and the pages and service
  workers not at all (Caddy says `no-cache`). There is nothing to purge after a deploy.
- **Something wrong only through Cloudflare?** Set the record to DNS only (grey cloud) for a minute and try the site
  directly. Caddy's certificate is a real Let's Encrypt one, so the site works the same either way (the firewall in
  step 3 must let you through for that).
- **Logs** rotate at 10 MB × 5 per container. `docker compose logs --since 1h web` for requests.
- **The town pages** search engines read are made when the web image is built, from the towns the live API has then:
  the first release has none. Released from GitHub, they are fetched again at the first release of each day; to
  refresh them now, run the Deploy workflow by hand with the release left empty.
- **Nothing watches the site.** DigitalOcean's monitoring can alert on the Droplet; an uptime check on `/v1/health`
  is the first thing to add.
