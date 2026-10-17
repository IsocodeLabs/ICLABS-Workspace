# Build from the repository root:  docker build -f apps/web/Dockerfile .
FROM node:24-alpine AS base
# Non-interactive: corepack fetches the pinned pnpm without prompting.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @iclabs/web build

# Database migrations, then the team bootstrap; run as a Cloud Run job before each rollout.
FROM build AS migrate
CMD ["sh", "-c", "pnpm --filter @iclabs/db migrate && pnpm --filter @iclabs/web bootstrap"]

FROM node:24-alpine AS runtime
ENV NODE_ENV=production PORT=8080 HOSTNAME=0.0.0.0
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /repo/apps/web/.next/standalone ./
COPY --from=build --chown=app:app /repo/apps/web/.next/static ./apps/web/.next/static
USER app
EXPOSE 8080
CMD ["node", "apps/web/server.js"]
