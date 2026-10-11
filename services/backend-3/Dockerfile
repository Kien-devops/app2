# Production Dockerfile for app2-backend-3
FROM node:22-alpine
WORKDIR /app

ENV NODE_ENV=production \
    PORT=8083

# Copy shared contract & package files
COPY shared/ ./shared/
COPY services/backend-3/package*.json ./services/backend-3/

WORKDIR /app/services/backend-3
RUN npm ci --omit=dev

# Copy application source code
COPY services/backend-3/src/ ./src/

# Security: Ensure non-root node user ownership
RUN chown -R node:node /app

USER node

EXPOSE 8083

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8083/health || exit 1

CMD ["node", "src/server.js"]
