# Build stage — install dependencies from the lockfile, nothing else.
FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache curl
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile --prod

# Runtime stage — only what the server needs to boot.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
	HOST=0.0.0.0 \
	PORT=3000 \
	UPTIME_DATA_DIR=/app/data

# curl is used by the healthcheck below.
RUN apk add --no-cache curl

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY lib ./lib
COPY public ./public
COPY server.js ./

# Non-root user; data/ must stay writable so monitors.json survives restarts.
RUN addgroup -S app && adduser -S app -G app \
	&& mkdir -p /app/data \
	&& chown -R app:app /app
USER app

EXPOSE 3000

# /api/health answers without touching disk, so it is safe as a container probe.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
	CMD curl -fsS "http://127.0.0.1:${PORT}/api/health" || exit 1

CMD ["node", "server.js"]
