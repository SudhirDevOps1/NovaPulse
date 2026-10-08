# Multi-stage production build for NovaPulse
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    UPTIME_DATA_DIR=/app/data

# Create data directory and non-root user
RUN mkdir -p /app/data && chown -R node:node /app

COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./
COPY server.js ./
COPY lib/ ./lib/
COPY public/ ./public/

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
