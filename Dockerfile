# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy TypeScript configuration files
COPY tsconfig.json ./
COPY tsconfig.build.json ./
COPY nest-cli.json ./

# Copy source code
COPY src ./src

# Build the application
RUN npm run build

# Production stage
FROM node:20-alpine AS production

# Create non-root user for security BEFORE creating /app
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001

WORKDIR /app

# Set ownership of /app to nestjs user
RUN chown nestjs:nodejs /app

# Set environment
ENV NODE_ENV=production

# Switch to non-root user BEFORE installing dependencies
# This way all files are created with correct ownership
USER nestjs

# Copy package files
COPY --chown=nestjs:nodejs package*.json ./

# Install production dependencies only (as nestjs user, so files are owned correctly)
RUN npm ci --only=production && npm cache clean --force

# Copy built application from builder stage
COPY --chown=nestjs:nodejs --from=builder /app/dist ./dist

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/v1/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))" || exit 1

# Start the application
CMD ["node", "dist/main"]
