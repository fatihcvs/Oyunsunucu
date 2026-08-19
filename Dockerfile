# Riftory web application image.
#
# The build emits a Workers-shaped module that `scripts/serve.mjs` serves over a
# plain Node http server, so one artifact runs both on an edge runtime and here.
FROM node:22.19-bookworm-slim AS build

WORKDIR /app
ENV npm_config_update_notifier=false

# Dependencies are installed from the lockfile alone so this layer is reused
# whenever only application source changed.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npx vinext build

# Drop build-only dependencies from the tree that ships.
RUN npm prune --omit=dev

FROM node:22.19-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/infra ./infra
COPY --from=build /app/lib ./lib

# Never run the server as root.
USER node

EXPOSE 3000

# `RIFTORY_ROLE` selects web or worker; the entrypoint applies migrations first
# and then `exec`s the chosen process so it receives SIGTERM directly. Without
# that exec the shell stays PID 1, the signal never arrives, and every redeploy
# ends in a SIGKILL.
CMD ["sh", "scripts/container-entrypoint.sh"]
