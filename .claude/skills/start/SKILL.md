---
name: start
description: Start SeeBuyGet — the backend and frontend apps in dev mode (hot reload), or the Docker stack (local or cloud). Use when the user asks to start, run, launch or bring up the app, the backend, the apps or the stack.
argument-hint: "[dev|docker] [app...] [seed]   e.g. /start · /start driver tower · /start docker seed"
allowed-tools: Bash(04_platform/scripts/app.sh:*), Bash(open -a Docker), Bash(cp 04_platform/.env.local.example 04_platform/.env)
---

Start SeeBuyGet with `04_platform/scripts/app.sh`, run from the repository root. Arguments: `$ARGUMENTS`

## Pick the mode

- **dev** (the default; use it when the arguments name no mode): Node on this machine with hot reload. The backend
  on :3000 plus the apps named in the arguments; with none named, `driver`. Apps: `home driver agent genesis`
  (the Send app, at /send/) `fleet mdp vendor business tower` (the operator console). "console" means `tower`,
  "send" means `genesis`, "all" means every one of them.
- **docker**: the stack in `04_platform/docker-compose.yml`. Use it when the arguments say docker, compose,
  container, production-like or cloud. `04_platform/.env` decides local or cloud.

## Run it

```bash
04_platform/scripts/app.sh start dev <apps...>
04_platform/scripts/app.sh start docker
```

Give the command a 10-minute timeout: the first dev start installs dependencies, and a docker start builds images.
The script returns once everything is up; the dev processes keep running in the background.

If the arguments include `seed`, run `04_platform/scripts/app.sh seed <mode>` after it is up, and show the user the
sign-in sheet it prints.

## When it stops short

- **`Docker is not running`**: on macOS run `open -a Docker`, wait for `docker info` to succeed, then try again.
- **`no 04_platform/.env`** (docker mode): if the user wants it on this machine, run
  `cp 04_platform/.env.local.example 04_platform/.env` and start again. Never write a cloud `.env` yourself. It
  needs real secrets and domains: point the user to `04_platform/DEPLOY.md`.
- **A port is taken by the other mode**: the script says which. Ask whether to stop that mode first. Don't stop it
  on your own.
- **Did not come up**: the script prints the last lines of the log. Read them, and say what went wrong.

## Report

Reply with one line per piece that is up, with its address exactly as the script printed it. Mention `/stop` to
stop it.
