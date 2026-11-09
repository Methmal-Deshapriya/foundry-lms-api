# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS base
WORKDIR /app
RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*

FROM base AS dependencies
COPY package.json package-lock.json ./
COPY prisma.config.js ./
COPY prisma ./prisma
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund \
      --fetch-retries=5 \
      --fetch-retry-mintimeout=20000 \
      --fetch-retry-maxtimeout=120000

# One-off operational image. It retains Prisma CLI and the complete migration
# history, and can also run bootstrap-super-admin.js by overriding CMD.
FROM base AS migrate
ENV NODE_ENV=production
COPY --from=dependencies /app/node_modules ./node_modules
COPY --chown=node:node package.json package-lock.json prisma.config.js ./
COPY --chown=node:node prisma ./prisma
COPY --chown=node:node src ./src
USER node
CMD ["./node_modules/.bin/prisma", "migrate", "deploy"]

# Remove development-only packages after Prisma Client has been generated.
# --ignore-scripts prevents the postinstall Prisma CLI command from running
# after that CLI has intentionally been removed.
FROM dependencies AS production-dependencies
RUN npm prune --omit=dev --ignore-scripts \
    && rm -rf node_modules/prisma node_modules/.bin/prisma

FROM base AS runner
ENV NODE_ENV=production \
    PORT=5000

COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node src ./src

# These generated Postman artifacts are served in development only today, but
# retaining them keeps the runtime image compatible with the existing route
# implementation if that policy changes without requiring an image redesign.
COPY --chown=node:node postman ./postman

USER node
EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:5000/api/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["node", "src/index.js"]
