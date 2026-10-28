# Build stage
# Upgraded to Node 22 LTS (node:22-slim) to resolve October security vulnerabilities (CVE-2026-111497 Brotli RCE / Node2Shell)
FROM node:22-slim AS builder
WORKDIR /usr/src/app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

# Runtime stage
FROM node:22-slim AS runner
WORKDIR /usr/src/app

COPY package*.json ./
COPY --from=builder /usr/src/app/dist ./dist

RUN npm ci --omit=dev

ENV NODE_ENV=production
EXPOSE 3001

CMD ["npm", "run", "start:prod"]
