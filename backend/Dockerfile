FROM node:22-alpine AS deps

WORKDIR /app
ENV NODE_ENV=production

# Refresh Alpine packages and install only production dependencies.
RUN apk update && apk upgrade --no-cache

COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
 && npm cache clean --force

COPY . .

FROM gcr.io/distroless/nodejs22-debian12:nonroot

WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app /app

EXPOSE 3001
CMD ["server.js"]