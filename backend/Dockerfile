FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production

# Refresh Alpine packages to get security fixes
RUN apk update && apk upgrade --no-cache

COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund \
 && npm cache clean --force

COPY . .

RUN chown -R node:node /app
USER node

EXPOSE 3001
CMD ["node", "server.js"]