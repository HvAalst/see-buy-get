# GLOS Sandbox — run & test

NestJS backend (`backend/`, port **3000**) + vanilla-JS frontend (`frontend/src`, port **4173**).
No framework/bundler — each surface is an ES-module page with its own state + a `fetch` API client.

## Run it

```bash
# from 04_generated_sandbox/
npm run dev        # starts backend (:3000) + frontend (:4173) together, prefixed logs
```

Then, once the backend is up, in another terminal:

```bash
npm run seed       # creates demo data and prints the click-through URLs
```

(You can also run the two halves separately: `npm run backend` / `npm run frontend`.)

## What `seed` creates

A full slice you can click through end-to-end:

- **2 PUDO agents** (NorthTown, EastTown) + an **MDP sort hub**
- a **vendor** + an **inbound e-commerce order** (with a buyer collection code)
- an **ACTIVE fleet manager** (vetted + bonded) with a **sign-in code** (e.g. `FM-XXXX`)
- **vehicles** (a motorcycle + a verified reefer truck) and **drivers** (a light bike courier + a vetted heavy driver), all under that manager
- the bike courier **on shift** (scanned the vehicle QR) with a **GPS position**
- an **outbound bag** released to the marketplace and **claimed** → cargo in motion on the fleet map

The seed prints the URLs, including:

| Surface | URL |
| --- | --- |
| **Launcher (start here)** | `http://localhost:4173/hub.html` |
| Agent app | `…/agent.html?agent=<did>` |
| Driver app | `…/driver.html?driver=<did>` |
| MDP worker app | `…/mdp.html?mdp=<id>` |
| Merchant console | `…/vendor.html` |
| Fleet console (manager) | `…/fleet.html` → sign in with the `FM-…` code |
| Fleet console (operator) | `…/fleet.html?ops=1` |
| PUDO control tower | `…/pudo-tower.html` |

Start at **`hub.html`** — it lists every surface and pre-selects a seeded entity so you can jump straight in.

> Note: it's an in-memory backend — restarting it clears the data; just run `npm run seed` again.
