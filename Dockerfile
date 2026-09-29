# syntax=docker/dockerfile:1

# ── Base with pnpm ──
FROM node:22-slim AS base
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable && corepack prepare pnpm@12.4.2 --activate

# ── Install dependencies ──
FROM base AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# ── Build ──
FROM base AS builder

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

# ── Production runner ──
FROM node:22-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV WORKSPACE_DIR=/home/nextjs/workspace
ENV WEBSITES_ENABLE_APP_SERVICE_STORAGE=true

RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs \
  && mkdir -p /home/nextjs/workspace \
  && chown -R nextjs:nodejs /app /home/nextjs

# Next.js standalone server output.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./

# Static assets are not included in standalone output by default.
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Keep full pnpm node_modules because this app uses native packages
# (@llamaindex/liteparse/libpdfium) that must be available at runtime.
COPY --from=deps --chown=nextjs:nodejs /app/node_modules ./node_modules

USER nextjs

EXPOSE 3000

# Uploaded documents, document.md, liteparse.json, result.json, and traces.
# On Azure App Service, keep WEBSITES_ENABLE_APP_SERVICE_STORAGE=true so /home persists across restarts.
VOLUME ["/home/nextjs/workspace"]

CMD ["node", "server.js"]
