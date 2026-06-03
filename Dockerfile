FROM node:20-bullseye AS builder
WORKDIR /app

# Install dependencies (including devDeps needed for build)
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps

# Copy source and build
COPY . .
RUN npm run build

FROM node:20-bullseye-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

# Install only production deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --legacy-peer-deps

# Copy build artifacts
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public

EXPOSE 3000
CMD ["node", "dist/server.cjs"]
