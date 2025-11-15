# syntax=docker/dockerfile:1
FROM node:20-alpine AS base

ENV NODE_ENV=production
WORKDIR /app

# Install production dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy application source
COPY src ./src
COPY data ./data

# Ensure runtime user has access to writable directories
RUN addgroup -g 1001 app && adduser -D -G app -u 1001 app \
  && chown -R app:app /app
USER app

EXPOSE 3000
CMD ["node", "src/server.js"]
