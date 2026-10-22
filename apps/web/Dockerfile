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

# Database migrations, the team bootstrap, then the careers roles' processes (idempotent; never
# touches a track edited in the builder, and a failure there doesn't block the rollout).
# Runs as a Cloud Run job before each rollout.
FROM build AS migrate
CMD ["sh", "-c", "pnpm --filter @iclabs/db migrate && pnpm --filter @iclabs/web bootstrap && (pnpm --filter @iclabs/web setup-roles || echo 'setup-roles failed; roles left as they were')"]

FROM node:24-alpine AS runtime
ENV NODE_ENV=production PORT=8080 HOSTNAME=0.0.0.0
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /repo/apps/web/.next/standalone ./
COPY --from=build --chown=app:app /repo/apps/web/.next/static ./apps/web/.next/static
# public/ holds the email header image (emails load it from workspace.isocodelabs.com/email/…)
COPY --from=build --chown=app:app /repo/apps/web/public ./apps/web/public
USER app
EXPOSE 8080
CMD ["node", "apps/web/server.js"]
