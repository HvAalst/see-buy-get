# GLOS Sandbox — run & test

NestJS backend (`backend/`, port **3000**) + eight Preact/Vite apps (`frontend/src/apps`, one port each).
The hand-rolled vanilla pages are all gone; `frontend/README.md` is the guide to the apps and their build.

## Run it

```bash
# from 04_generated_sandbox/
npm run dev        # backend (:3000) + the default app (driver, :5173), prefixed logs
```

Vite builds ONE app at a time, so pick another by starting it yourself:
`SBG_APP=tower npm --prefix frontend run dev` (the operator console, :5181).

Then, once the backend is up, in another terminal:

```bash
npm --prefix backend run seed:demo   # demo data + the sign-in sheet for every app
```

(You can also run the two halves separately: `npm run backend` / `npm run frontend`.)

> `npm run seed` at this level is the OLD seeder: it still populates a backend, but it prints URLs for
> pages that no longer exist. `seed:demo` in `backend/` is the one that is maintained.

## What `seed` creates

A full slice you can click through end-to-end:

- **2 PUDO agents** (NorthTown, EastTown) + an **MDP sort hub**
- a **vendor** + an **inbound e-commerce order** (with a buyer collection code)
- an **ACTIVE fleet manager** (vetted + bonded) with a **sign-in code** (e.g. `FM-XXXX`)
- **vehicles** (a motorcycle + a verified reefer truck) and **drivers** (a light bike courier + a vetted heavy driver), all under that manager
- the bike courier **on shift** (scanned the vehicle QR) with a **GPS position**
- an **outbound bag** released to the marketplace and **claimed** → cargo in motion on the fleet map

Where the surfaces live:

| Surface | URL |
| --- | --- |
| Home | `http://localhost:5180/` |
| Driver app | `http://localhost:5173/driver/` |
| Agent app (a shop) | `http://localhost:5175/agent/` |
| Send app | `http://localhost:5176/send/` |
| Fleet console | `http://localhost:5177/fleet/` |
| Hub (MDP) app | `http://localhost:5178/mdp/` |
| Merchant console | `http://localhost:5179/vendor/` |
| Operator console | `http://localhost:5181/tower/` |

Each app runs on its own Vite port and only when you start it: `SBG_APP=<app> npm --prefix frontend run dev`.
The sign-in sheet `seed:demo` prints has the logins for each one.

> Note: it's an in-memory backend — restarting it clears the data; just run `seed:demo` again.
