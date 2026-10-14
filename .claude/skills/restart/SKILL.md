---
name: restart
description: Restart SeeBuyGet — the dev processes (backend and frontend apps) or the Docker stack, optionally rebuilding the images. Use when the user asks to restart, reload or bounce the app, the backend or the stack, or to pick up a change that hot reload did not.
argument-hint: "[dev|docker] [app...] [rebuild]   e.g. /restart · /restart driver tower · /restart docker rebuild"
allowed-tools: Bash(04_platform/scripts/app.sh:*)
---

Restart SeeBuyGet with `04_platform/scripts/app.sh`, run from the repository root. Arguments: `$ARGUMENTS`

## Pick what to restart

- The arguments name `dev` or `docker`: that one.
- They name neither: run `04_platform/scripts/app.sh status dev` and `04_platform/scripts/app.sh status docker`.
  Restart whichever is running. If neither is running, start dev with the `/start` steps and say that you did.

## Dev

```bash
04_platform/scripts/app.sh restart dev <apps...>
```

With no apps named, restart the apps that `status dev` showed running, so the user gets back what they had. Use a
10-minute timeout.

## Docker

- **Plain restart.** It restarts the containers and keeps the images: `04_platform/scripts/app.sh restart docker`.
- **Rebuild.** When the arguments say `rebuild`, or code has changed since the images were built, rebuild and
  restart with `04_platform/scripts/app.sh start docker`. That runs `docker compose up -d --build`, which replaces
  only the containers whose images changed. Use a 10-minute timeout.

If `04_platform/.env` is the cloud one (its `COMPOSE_FILE` names `docker-compose.cloud.yml`, so this machine is a
live server), ask before restarting unless the user has said so in this request. A restart takes the site down
for a few seconds.

Never remove a volume to get a clean start. `api-data` is the real data.

## Report

One line per piece that is up again, with its address as the script printed it.
