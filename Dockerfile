FROM node:22-trixie-slim

# Debian's own intel-media-va-driver-non-free is too old to recognize newer
# Intel iGPUs (e.g. N100/N150 "Alder Lake-N"/"Twin Lake" - PCI device 46D4)
# and fails VAAPI init entirely. Jellyfin publishes jellyfin-ffmpeg, which
# bundles its own current Intel media driver alongside ffmpeg, sidestepping
# distro packaging lag. This matches the same package already verified
# working for QSV on this hardware via the jellyfin/jellyfin image.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates gnupg curl \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://repo.jellyfin.org/jellyfin_team.gpg.key | gpg --dearmor -o /etc/apt/keyrings/jellyfin.gpg \
    && printf 'Types: deb\nURIs: https://repo.jellyfin.org/debian\nSuites: trixie\nComponents: main\nArchitectures: amd64\nSigned-By: /etc/apt/keyrings/jellyfin.gpg\n' > /etc/apt/sources.list.d/jellyfin.sources \
    && apt-get update && apt-get install -y --no-install-recommends jellyfin-ffmpeg7 \
    && ln -s /usr/lib/jellyfin-ffmpeg/ffmpeg /usr/local/bin/ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# jellyfin-ffmpeg bundles its own Intel media driver rather than relying on
# the (too old) system one; point libva at it explicitly.
ENV LIBVA_DRIVERS_PATH=/usr/lib/jellyfin-ffmpeg/lib/dri

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY . .
RUN chmod 0755 /app/docker-entrypoint.sh

ENV PORT=8080
EXPOSE 8080

# Liveness only: /stream/metrics is served from in-process state and never
# touches the HDHomeRun, so a tuner outage does not mark the container unhealthy.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/stream/metrics',{signal:AbortSignal.timeout(4000)}).then((r)=>process.exit(r.ok?0:1),()=>process.exit(1))"]

# The entrypoint starts as root only to read the /dev/dri group IDs and then
# drops to the unprivileged `node` user (with those groups) before running the app.
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "server.js"]
