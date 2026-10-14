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
# VITE_SBG_SITE is the public site as the console sees it: the console is on another address, and a link to
# somebody's public page (/@handle) must leave it for the site.
ENV SBG_PUBLIC_URL=${SBG_PUBLIC_URL} \
    VITE_SBG_API=${SBG_PUBLIC_URL} \
    VITE_SBG_SITE=${SBG_PUBLIC_URL}
WORKDIR /repo/04_platform/frontend
COPY 04_platform/frontend/package*.json ./
RUN npm ci
COPY 04_platform/frontend/ ./
# The town pages are fetched from the live API by this build, and a build whose files have not changed is not run
# again: it is taken from the cache, towns and all. PAGES_AS_OF is what makes it run — the deploy workflow passes the
# day, so the pages are never older than the day of the release.
ARG PAGES_AS_OF
RUN echo "public pages as of: ${PAGES_AS_OF:-this build}" && npm run build

# Caddy with the two plugins a site behind Cloudflare needs: certificates by DNS challenge through Cloudflare's API
# (the proxy stands between Let's Encrypt and this server), and Cloudflare's address ranges, kept current, so the
# visitor's own address can be believed from Cloudflare and from nobody else. Unused when CADDY_EDGE is not cloudflare.
FROM caddy:2.11-builder-alpine AS caddy
RUN xcaddy build \
      --with github.com/caddy-dns/cloudflare \
      --with github.com/WeidiDeng/caddy-cloudflare-ip

FROM caddy:2.11-alpine
ARG SBG_PUBLIC_URL
# The address the apps were built to call. scripts/deploy.sh reads it back, and will not put an image built for one
# address on a server that answers at another.
LABEL com.seebuyget.public-url="${SBG_PUBLIC_URL}"
COPY --from=caddy /usr/bin/caddy /usr/bin/caddy
COPY 04_platform/frontend/Caddyfile /etc/caddy/Caddyfile
COPY --from=builder /repo/04_platform/frontend/dist /srv/site
COPY --from=builder /repo/04_platform/frontend/dist-console /srv/console
# The help page the front page and every email link to (SBG_PUBLIC_URL/help.html).
COPY help.html /srv/site/help.html
# A Caddyfile that does not read stops the build here, not the site on the server.
RUN SBG_PUBLIC_URL=http://localhost:8080 SBG_CONSOLE_URL=http://localhost:8081 CADDY_EDGE=direct \
    CONSOLE_ALLOW_IPS="0.0.0.0/0 ::/0" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
# The Caddyfile's own small answer on the loopback address, inside the container only.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --start-interval=2s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:9180/ || exit 1
