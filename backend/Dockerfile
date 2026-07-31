FROM node:22-bookworm-slim AS deps

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
 && npm cache clean --force

COPY . .

FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app /app

USER node

EXPOSE 3001
CMD ["node", "server.js"]