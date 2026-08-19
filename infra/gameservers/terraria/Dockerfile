# Vanilla Terraria with a shutdown path that actually saves the world.
#
# Certification found that the upstream image is killed by SIGTERM (exit 137)
# because Terraria only writes the world when `exit` is entered on its console.
# This image keeps the upstream server binaries and replaces the entrypoint with
# one that turns SIGTERM into that console command.
FROM ryshe/terraria:vanilla-1.4.4.9

COPY entrypoint.sh /riftory/entrypoint.sh
RUN chmod +x /riftory/entrypoint.sh

ENV WORLD_DIR=/root/.local/share/Terraria/Worlds \
    WORLD_NAME=Riftory \
    WORLD_SIZE=1 \
    DIFFICULTY=0 \
    MAXPLAYERS=8 \
    PORT=7777 \
    SHUTDOWN_TIMEOUT=90

EXPOSE 7777
ENTRYPOINT ["/bin/sh", "/riftory/entrypoint.sh"]
