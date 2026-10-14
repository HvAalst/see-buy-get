# GLOS backend — the NestJS API, multi-stage.
#
#   docker build -t sbg-api 04_platform/backend
#
# Production by default (GLOS_ENV=production): the server will not start until every secret in
# ../.env.cloud.example is set. docker-compose.local.yml runs it as a sandbox instead. Durable state lives in
# /data — mount a volume there, or a redeploy loses sign-ins and prepaid balances
# (see src/foundation/store/persistent-map.ts).

FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    GLOS_ENV=production \
    GLOS_DATA_DIR=/data \
    PORT=3000
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist
# Read at runtime: the built-in help illustrations resolve from the package root (src/modules/pudo/help-builtins.ts).
COPY assets ./assets
# The demo seeder, for a local sandbox stack: `docker compose exec api node scripts/seed-demo.mjs`. Plain Node, no
# dependencies; against a production server it is refused (its sign-in grant is closed there).
COPY scripts ./scripts
# Created here, owned by `node`, so a fresh named volume mounted on it inherits that owner.
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/v1/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/main.js"]
