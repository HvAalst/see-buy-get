# SeeBuyGet web — every app built, then served by Caddy (automatic HTTPS), which also proxies /v1 to the API.
#
# Built from the REPOSITORY ROOT, because the public site serves help.html, which lives there:
#   docker build -f 04_platform/frontend/Dockerfile --build-arg SBG_PUBLIC_URL=https://seebuyget.com .
#
# The site's address is baked into the apps (and the service workers) at build time, and the API is reached at that
# same address under /v1 — so a new address is a rebuild. The front page's town pages are fetched from that API while
# building: when it is not up yet, the build still makes the front page and says it made no town pages.

FROM node:22-alpine AS builder
ARG SBG_PUBLIC_URL
RUN test -n "$SBG_PUBLIC_URL" || (echo "SBG_PUBLIC_URL build arg is required (e.g. https://seebuyget.com)" >&2; exit 1)
ENV SBG_PUBLIC_URL=${SBG_PUBLIC_URL} \
    VITE_SBG_API=${SBG_PUBLIC_URL}
WORKDIR /repo/04_platform/frontend
COPY 04_platform/frontend/package*.json ./
RUN npm ci
COPY 04_platform/frontend/ ./
RUN npm run build

FROM caddy:2.11-alpine
COPY 04_platform/frontend/Caddyfile /etc/caddy/Caddyfile
COPY --from=builder /repo/04_platform/frontend/dist /srv/site
COPY --from=builder /repo/04_platform/frontend/dist-console /srv/console
# The help page the front page and every email link to (SBG_PUBLIC_URL/help.html).
COPY help.html /srv/site/help.html
