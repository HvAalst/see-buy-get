# Going live: seebuyget.com

The chain:

```
visitor → Cloudflare (DNS + proxy + HTTPS) → Droplet (web server → app + database)
MijnDomein: only holds the domain; its nameservers point to Cloudflare
GitHub: every push to main → tests → build → Droplet (automatic)
```

Nothing has to be built for this: the repository already releases every push to `main` to the Droplet
(`.github/workflows/deploy.yml` and `04_platform/scripts/deploy.sh`). If a test fails, nothing is released; if a new
release does not start, the one before comes back by itself. The full manual is `04_platform/DEPLOY.md`.

**Where you are (2026-10-22, 16:08 UTC): LIVE.** https://seebuyget.com and https://ops.seebuyget.com answer through
Cloudflare, and every push to `main` now goes live (`84bce73`, the first release green to its last step). Steps 1–8
are done. Left: the "straight after" items of step 9 (save the server's settings, the first staff account, the Twilio
and ZeptoMail keys), and step 10. The certificate is checked through Cloudflare's resolvers (`56dd044`):
DigitalOcean's kept MijnDomein's old nameservers for hours after the switch.

---

## 1. DigitalOcean — the Droplet ☐

- [ ] The Droplet exists: **138.68.77.250**.
- [ ] Ubuntu 24.04, **2 GB RAM or more**, **Backups on**, **IPv6 off**, your own SSH key on it.

## 2. Cloudflare — the domain and its DNS records ◐

- [x] Domain `seebuyget.com` added (Free plan).
- [x] Records (DNS → Records), as checked on 2026-10-21:

| Type | Name | Content | Proxy | |
|---|---|---|---|---|
| `A` | `seebuyget.com` | `138.68.77.250` | Proxied (orange) | ✅ |
| `A` | `ops` | `138.68.77.250` | Proxied (orange) | ✅ |
| `CNAME` | `www` | `seebuyget.com` | Proxied (orange) | ✅ |
| `TXT` | `seebuyget.com` | `"v=spf1 a mx include:spf.mijndomeinhosting.nl -all"` | DNS only (grey) | ✅ |
| `CNAME` | `_dmarc` | `dmarc-reject.mijndomein.nl` | **must be DNS only (grey)** | ❌ |

- [ ] **Fix:** Edit the `_dmarc` record → switch the orange cloud to **grey (DNS only)**. Cloudflare can only proxy website
  traffic; proxied, mail servers cannot read the record that tells them to reject fake mail from seebuyget.com.
- [ ] **Check:** there is no `MX` record. If you receive email at an @seebuyget.com address today, copy the `MX`
  records from MijnDomein's DNS into Cloudflare (DNS only) **before** step 5. If not, nothing to do.
- Never add: `AAAA` records (the Droplet does not answer over IPv6), a wildcard (`*`), or `CAA` records.
- Later, for ZeptoMail (email from the app): its records go in as DNS only, and the SPF line gets ZeptoMail added.

## 3. Cloudflare — HTTPS settings ☐

There are two certificates, both free and automatic:

```
visitor ──HTTPS──► Cloudflare ──HTTPS──► Droplet
       certificate 1          certificate 2
```

**Certificate 1 (visitor ↔ Cloudflare)** — Cloudflare makes it by itself. SSL/TLS → **Edge Certificates**:

- [ ] Always Use HTTPS: **On**
- [ ] Minimum TLS Version: **TLS 1.2**
- [ ] TLS 1.3: **On**
- [ ] Automatic HTTPS Rewrites: On
- [ ] HSTS: **leave off for now** — hard to undo; switch it on after the site has run well for a few weeks.

**Certificate 2 (Cloudflare ↔ Droplet)** — the Droplet's web server gets a free Let's Encrypt certificate by itself
(it proves the domain is yours by writing a DNS record through Cloudflare — the token in step 4).

- [ ] SSL/TLS → Overview → **Full (strict)**. Never "Flexible": it sends the traffic to the Droplet unencrypted.
- Do **not** use Cloudflare's "Origin Certificate": the server is not set up for it and does not need it.

Also:

- [ ] Speed → Optimization → **Rocket Loader off** (it rewrites the pages' scripts and breaks the apps).
- [ ] Rules → Redirect Rules → template **"Redirect from WWW to root"**.

## 4. Cloudflare — an API token for the certificate ☐

- [ ] My Profile → API Tokens → **Create Token** → template **"Edit zone DNS"**.
  - Permissions: `Zone → DNS → Edit`, and add a row `Zone → Zone → Read`.
  - Zone resources: `Include → Specific zone → seebuyget.com`.
- [ ] Copy the token somewhere safe (password manager). It goes into the server's settings in step 7.

## 5. MijnDomein — point the domain at Cloudflare ☐

**Before:**

- [ ] Email checked (step 2).
- [ ] DNSSEC checked. In PowerShell:

  ```powershell
  nslookup -type=DS seebuyget.com 1.1.1.1
  ```

  A DS record in the answer means DNSSEC is on: switch it off at MijnDomein first (ask their support if there is no
  setting for it). Otherwise the domain stops working after the switch. No DS record: skip this.

**At MijnDomein** (from their help desk; a label may differ slightly):

1. [ ] Log in to **Mijn Account**.
2. [ ] Left menu → **Mijn producten**.
3. [ ] Click the **arrow** next to `seebuyget.com`.
4. [ ] Click **Beheren**.
5. [ ] Under **Nameserver wijzigen** → **Wijzigen**.
6. [ ] Replace MijnDomein's nameservers with the **two Cloudflare shows you** (Cloudflare → the domain → Overview):
   orange pencil to change, red cross to delete the extra ones, **lowercase only**.
7. [ ] **Opslaan**.

**After:**

- [ ] In Cloudflare, click **"Check nameservers"**. It takes up to 24 hours (often an hour or two); Cloudflare emails
  you when the domain is **Active**.
- [ ] Optional, once active: Cloudflare → DNS → Settings → enable DNSSEC, and paste the DS record it gives you at
  MijnDomein.
- Until the first release (step 9) the site shows a Cloudflare error (52x). That is expected.
- **The certificate.** The Droplet's web server proves the domain by writing a record at Cloudflare, and that only
  counts once the nameservers point there. It tries again by itself, but only every few hours; once Cloudflare says
  **Active**, make it try at once (it restarts only the web server, not the app or the database):

  ```powershell
  ssh -i $HOME\.ssh\seebuyget-deploy deploy@138.68.77.250 "cd /opt/seebuyget && docker compose restart web"
  ```

  Then https://seebuyget.com/v1/health answers within a few minutes. If it still fails, the world's DNS caches may
  hold MijnDomein's nameservers for up to a day: wait, and restart it again.

## 6. Your PC — a deploy key, and preparing the Droplet (once) ☐

In PowerShell, from the repository folder. When asked for a passphrase, press Enter twice (GitHub cannot type one):

```powershell
ssh-keygen -t ed25519 -C "seebuyget-deploy" -f $HOME\.ssh\seebuyget-deploy
scp 04_platform/scripts/setup-droplet.sh root@138.68.77.250:
ssh root@138.68.77.250 "bash setup-droplet.sh '$(Get-Content $HOME\.ssh\seebuyget-deploy.pub)'"
```

It installs Docker, makes a `deploy` user for GitHub, opens ports 80, 443 and SSH, and makes `/opt/seebuyget`.

- [ ] At the end it prints **DEPLOY_HOST** and **DEPLOY_KNOWN_HOSTS**. Keep both for step 8.

## 7. The Droplet — tell it it sits behind Cloudflare (once, before the first release) ☐

Without this, the first release sets the server up as if there were no Cloudflare and gets no certificate.

```powershell
scp 04_platform/.env.cloud.example root@138.68.77.250:/opt/seebuyget/.env
ssh root@138.68.77.250
nano /opt/seebuyget/.env
```

- [ ] Change these three lines:

  ```
  CADDY_EDGE=cloudflare
  CLOUDFLARE_API_TOKEN=<the token from step 4>
  SBG_REDIRECT_HOSTS=
  ```

- [ ] Save, then: `chown deploy:deploy /opt/seebuyget/.env && chmod 600 /opt/seebuyget/.env`

The first release fills in every secret itself.

## 8. GitHub — tell the repository where the server is ☐

The repository → Settings → Secrets and variables → Actions:

| Kind | Name | Value | |
|---|---|---|---|
| variable | `SBG_PUBLIC_URL` | `https://seebuyget.com` | ☐ |
| variable | `SBG_CONSOLE_URL` | `https://ops.seebuyget.com` | ☐ |
| variable | `DEPLOY_HOST` | from step 6 | ☐ |
| variable | `DEPLOY_KNOWN_HOSTS` | from step 6, the whole line | ☐ |
| secret | `DEPLOY_SSH_KEY` | the whole of `$HOME\.ssh\seebuyget-deploy` (the file **without** `.pub`) | ☐ |

- Do **not** set `SBG_REDIRECT_HOSTS`: Cloudflare sends `www` on (step 3).
- Optional: Settings → Environments → `production` → Required reviewers, if every release should wait for your yes.

## 9. The first release ☐

- [ ] Actions → **Deploy** → **Run workflow**.
- [ ] Green on the last step, "Ask the site, from outside" = live. From now on **every push to `main` goes live**.

**Straight after — only you can do these:**

- [ ] **Save the server's settings** in your password manager, then delete the local copy:

  ```powershell
  scp root@138.68.77.250:/opt/seebuyget/.env seebuyget.env
  ```

  It holds the keys that unlock the stored data; they can never be made again.
- [ ] **The first staff account:** open https://ops.seebuyget.com → the setup-key link under the sign-in form → enter
  `GLOS_CLIENT_SECRET` from that file.
- [ ] **Texts and email:** put the Twilio and ZeptoMail keys in `/opt/seebuyget/.env`, then:

  ```powershell
  ssh root@138.68.77.250 "cd /opt/seebuyget && docker compose up -d"
  ```

  Until Twilio is in, **nobody can sign up**.

## 10. Lock it down (recommended, about 10 minutes) ☐

- [ ] **DigitalOcean → Networking → Firewalls**, on the Droplet:
  - inbound port 22 from everywhere (GitHub signs in over SSH to release);
  - inbound ports 80 and 443 **only from Cloudflare's ranges** (https://www.cloudflare.com/ips/), so nobody goes
    around Cloudflare;
  - outbound: everything.
- [ ] **Cloudflare Zero Trust → Access → Applications**: a self-hosted application for `ops.seebuyget.com`, with a policy
  listing the staff's email addresses. Free up to 50 people.
- [ ] **An uptime check** on `https://seebuyget.com/v1/health` (DigitalOcean Monitoring or Cloudflare).

---

## Worth knowing

- The server runs **as live**, not as the sandbox: no demo data, no sign-in codes on screen, every secret required.
- Cloudflare decrypts the traffic in the middle (ID photos pass through it): the price of its proxy.
- On the server: `ssh root@138.68.77.250`, then `cd /opt/seebuyget` and
  - `./deploy.sh --status` — which release runs, and which ran before;
  - `docker compose logs -f api` — what the app says;
  - `./deploy.sh --rollback` — back to the release before (the code, not the data).
- Something wrong only through Cloudflare? Set the record to DNS only (grey) for a minute and try the site directly.
- The data is in two Docker volumes on the Droplet; the server also keeps a copy from before each of the last seven
  releases in `/opt/seebuyget/backups/`. Droplet Backups (step 1) cover a lost disk.

Sources for step 5: [MijnDomein help desk — De nameservers van je domeinnaam aanpassen](https://helpdesk.mijndomein.nl/hc/nl/articles/200426862-Nameservers-aanpassen).
