---
name: stop
description: Stop SeeBuyGet — the dev processes (backend and frontend apps) or the Docker stack. Use when the user asks to stop, shut down, kill or bring down the app, the servers or the stack.
argument-hint: "[dev|docker|all]   e.g. /stop · /stop docker"
allowed-tools: Bash(04_platform/scripts/app.sh:*)
---

Stop SeeBuyGet with `04_platform/scripts/app.sh`, run from the repository root. Arguments: `$ARGUMENTS`

## Pick what to stop

- The arguments name `dev` or `docker`: stop that one.
- They name `all`, or nothing: first see what is running, with `04_platform/scripts/app.sh status dev` and
  `04_platform/scripts/app.sh status docker`. Then stop whichever is up. If neither is up, say so and stop there.

```bash
04_platform/scripts/app.sh stop dev
04_platform/scripts/app.sh stop docker
```

## Never

- Never run `docker compose down -v`, `docker volume rm` or anything else that removes a volume. `api-data` holds
  the sign-ins, wallets and prepaid balances. `stop docker` keeps the volumes, and so must you.
- Never stop the stack when `04_platform/.env` is the cloud one (its `COMPOSE_FILE` names
  `docker-compose.cloud.yml`, so this machine is a live server) unless the user has said so in this request. If not,
  ask first: stopping a server takes the site down for everyone.

## Report

One line per piece that was stopped, or "nothing was running".
