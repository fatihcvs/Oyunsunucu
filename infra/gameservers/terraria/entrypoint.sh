#!/bin/sh
# Terraria saves the world only when `exit` is typed on its console. A plain
# SIGTERM kills the process mid-flight, so the container must translate the
# signal into the console command and then wait for the save to finish.
set -eu

WORLD_DIR="${WORLD_DIR:-/root/.local/share/Terraria/Worlds}"
WORLD_NAME="${WORLD_NAME:-Riftory}"
WORLD_FILE="${WORLD_DIR}/${WORLD_NAME}.wld"
WORLD_SIZE="${WORLD_SIZE:-1}"
DIFFICULTY="${DIFFICULTY:-0}"
MAXPLAYERS="${MAXPLAYERS:-8}"
PORT="${PORT:-7777}"
SHUTDOWN_TIMEOUT="${SHUTDOWN_TIMEOUT:-90}"

# The running server never echoes its configuration, so the runtime reports it.
# Support and the certification harness both read the effective values here
# instead of guessing from the container definition.
echo "[riftory] ayarlar world=${WORLD_NAME} maxplayers=${MAXPLAYERS} port=${PORT} difficulty=${DIFFICULTY}"

mkdir -p "${WORLD_DIR}"
CONSOLE="/tmp/terraria-console"
rm -f "${CONSOLE}"
mkfifo "${CONSOLE}"

# Opening the pipe read-write keeps it alive for the life of the script without
# a helper process: `sleep infinity` is not portable here, and a writer that
# exits would close the server's stdin immediately.
exec 3<> "${CONSOLE}"

/terraria-server/TerrariaServer.bin.x86_64 \
  -world "${WORLD_FILE}" \
  -autocreate "${WORLD_SIZE}" \
  -worldname "${WORLD_NAME}" \
  -difficulty "${DIFFICULTY}" \
  -maxplayers "${MAXPLAYERS}" \
  -port "${PORT}" \
  < "${CONSOLE}" &
SERVER_PID=$!

graceful_shutdown() {
  echo "[riftory] SIGTERM alindi, dunya kaydediliyor"
  printf 'exit\n' >&3

  waited=0
  while kill -0 "${SERVER_PID}" 2>/dev/null; do
    if [ "${waited}" -ge "${SHUTDOWN_TIMEOUT}" ]; then
      echo "[riftory] kayit ${SHUTDOWN_TIMEOUT} saniyede bitmedi, surec sonlandiriliyor" >&2
      kill -TERM "${SERVER_PID}" 2>/dev/null || true
      break
    fi
    sleep 1
    waited=$((waited + 1))
  done

  wait "${SERVER_PID}" 2>/dev/null || true
  echo "[riftory] kapanis tamamlandi, sure ${waited} sn"
  exit 0
}

trap graceful_shutdown TERM INT

# `wait` is interrupted by the trapped signal; the loop keeps the script alive
# until the server really exits on its own.
while kill -0 "${SERVER_PID}" 2>/dev/null; do
  wait "${SERVER_PID}" || true
done

exit 0
