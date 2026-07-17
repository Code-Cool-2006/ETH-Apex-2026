# --- Production Build Stage for React & Node Backend ---
FROM node:20-alpine AS builder
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy all source files
COPY . .

# Build frontend static assets to /app/dist
RUN npm run build

# --- Production Runtime Stage ---
FROM node:20-alpine
WORKDIR /app

# Copy production files
COPY package*.json ./
RUN npm ci --only=production

# Copy built assets and server scripts
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/backend ./backend
COPY model_weights.json ./

EXPOSE 5000

ENV NODE_ENV=production
ENV PORT=5000

CMD ["node", "backend/server.js"]
