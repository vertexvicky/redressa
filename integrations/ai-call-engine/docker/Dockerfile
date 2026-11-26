# ── Build stage ──────────────────────────────────
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/backend/package.json ./packages/backend/
COPY packages/frontend/package.json ./packages/frontend/

# Install dependencies
RUN npm install --production=false

# Copy source
COPY tsconfig.json ./
COPY packages/ ./packages/

# Build all packages
RUN npm run build

# ── Production stage ──────────────────────────────
FROM node:18-alpine AS production

WORKDIR /app

# Install production dependencies only
COPY package.json package-lock.json* ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/backend/package.json ./packages/backend/
RUN npm install --production --workspace=packages/backend --workspace=packages/shared

# Copy built files
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/backend/dist ./packages/backend/dist
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/packages/backend/package.json ./packages/backend/

# Create data directory
RUN mkdir -p /app/data

# Non-root user
RUN addgroup -g 1001 -S appgroup && adduser -S appuser -u 1001 -G appgroup
USER appuser

EXPOSE 4000

ENV NODE_ENV=production
ENV DATABASE_PATH=/app/data/ai-call-engine.sqlite

CMD ["node", "packages/backend/dist/index.js"]
