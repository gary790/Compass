FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies
COPY package*.json ./
RUN npm ci --legacy-peer-deps

# Copy source and build
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

# ============================================================
# Production Image
# ============================================================
FROM node:20-alpine

WORKDIR /app

# Install runtime dependencies
RUN apk add --no-cache git curl bash tini

# Install production-only node modules
COPY package*.json ./
RUN npm ci --legacy-peer-deps --omit=dev && npm cache clean --force

# Copy built application
COPY --from=builder /app/dist ./dist
COPY public/ ./public/
COPY migrations/ ./migrations/

# Create necessary directories
RUN mkdir -p workspaces/default logs

# Non-root user for security
RUN addgroup -S app && adduser -S app -G app
RUN chown -R app:app /app
USER app

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

# Expose ports
EXPOSE 3000

# Use tini for proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
