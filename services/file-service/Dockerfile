FROM node:22-alpine
WORKDIR /app

ENV NODE_ENV=production \
    PORT=8084 \
    STORAGE_PATH=/mnt/dr-data

COPY shared/ ./shared/
COPY services/file-service/package*.json ./services/file-service/

WORKDIR /app/services/file-service
RUN npm ci --omit=dev
COPY services/file-service/src/ ./src/

RUN chown -R node:node /app
USER node

EXPOSE 8084
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8084/health || exit 1

CMD ["node", "src/server.js"]
