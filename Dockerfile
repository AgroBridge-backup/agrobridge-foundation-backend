# =============================================================================
# AgroBridge Foundation Backend - Multi-stage Docker Build
# Optimized for Render free tier (minimal image size)
# =============================================================================

# --- Stage 1: Build ---
FROM node:20-slim AS builder

WORKDIR /app

# Install OpenSSL for Prisma
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY prisma ./prisma/
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src/
RUN npx tsc -p tsconfig.json

# --- Stage 2: Production ---
FROM node:20-slim AS production

WORKDIR /app

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd -r appuser && useradd -r -g appuser -s /bin/false appuser

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

# Copy Prisma schema + generated client
COPY prisma ./prisma/
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

# Copy compiled application
COPY --from=builder /app/dist ./dist/

# Copy startup script
COPY render-start.sh ./
RUN chmod +x render-start.sh

# Switch to non-root user
USER appuser

EXPOSE 10000

ENV NODE_ENV=production
ENV PORT=10000

CMD ["./render-start.sh"]
