# Production Dockerfile for app2-frontend
FROM node:22-alpine
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000

# Copy shared contract & package files
COPY shared/ ./shared/
COPY frontend/package*.json ./frontend/

WORKDIR /app/frontend
# frontend has zero external npm dependencies, but we support npm ci if lock exists
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; fi

# Copy application source code
COPY frontend/src/ ./src/

# Security: Ensure non-root node user ownership
RUN chown -R node:node /app

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1

CMD ["node", "src/server.js"]
