#!/bin/sh
# One image, two roles. The web service serves requests; the worker drains the
# provisioning queue. Keeping them in one image means they can never drift to
# different versions of the same contracts.
set -eu

# Both roles apply migrations. The runner takes a PostgreSQL advisory lock, so
# whichever starts first wins and the other simply finds nothing to do — that
# removes any start-order dependency between the services.
node scripts/migrate.mjs

case "${RIFTORY_ROLE:-web}" in
  worker)
    echo "[riftory] rol: worker"
    # `exec` so the process replaces the shell and receives SIGTERM directly;
    # without it a redeploy would kill the worker mid-job.
    exec node scripts/provisioning-worker.mjs
    ;;
  web)
    echo "[riftory] rol: web"
    exec node scripts/serve.mjs
    ;;
  *)
    echo "[riftory] bilinmeyen RIFTORY_ROLE: ${RIFTORY_ROLE}" >&2
    exit 64
    ;;
esac
