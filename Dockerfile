# Use official Node.js LTS image
FROM node:18-alpine

# Set working directory to the project root
WORKDIR /app

# Copy services directory first (required by backend)
COPY services/ ./services/

# Copy backend package files
COPY backend/package*.json ./backend/

# Install production dependencies
WORKDIR /app/backend
RUN npm ci --only=production

# Copy backend application code
COPY backend/ ./

# Set working directory back to backend for runtime
WORKDIR /app/backend

# Create a non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Expose port 3000 (default for the application)
EXPOSE 3000

# Set environment variable to bind to all interfaces
ENV HOST=0.0.0.0

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start the application
CMD ["node", "server.js"]

