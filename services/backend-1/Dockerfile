# Production Dockerfile for app2-backend-1
FROM node:22-alpine
WORKDIR /app

ENV NODE_ENV=production \
    PORT=8081

# Copy shared contract & package files
COPY shared/ ./shared/
COPY services/backend-1/package*.json ./services/backend-1/

WORKDIR /app/services/backend-1
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; fi

# Copy application source code
COPY services/backend-1/src/ ./src/

# Security: Ensure non-root node user ownership
RUN chown -R node:node /app

USER node

EXPOSE 8081

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8081/health || exit 1

CMD ["node", "src/server.js"]
