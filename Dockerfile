# ==========================================
# 🐚 Coral AI Bot — SRE Container Runtime
# ==========================================

# Use official lightweight Node.js Debian image
FROM node:20-bookworm-slim

# Set environment production metadata
ENV NODE_ENV=production
ENV PORT=3001

# Install system dependencies & SRE diagnostic utilities
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    jq \
    git \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Install Coral CLI (multi-platform Linux binary sh installer)
RUN curl -fsSL https://withcoral.com/install.sh | sh

# Install pnpm package manager globally
RUN npm install -g pnpm

# Set application home directory
WORKDIR /app

# Copy dependency specifications
COPY package.json pnpm-lock.yaml tsconfig.json vite.config.ts ./

# Install all development and production dependencies
RUN pnpm install --frozen-lockfile

# Copy SRE source code, schemas, datasets, and setup scripts
COPY src ./src
COPY coral-sources ./coral-sources
COPY scripts ./scripts
COPY index.html ./

# Build production client assets
RUN pnpm run build

# Run portability setup script to adapt Coral YAML absolute paths dynamically 
# to the /app directory inside the container and register schemas with CLI.
RUN pnpm run setup

# Expose ports: 3000 (Vite frontend client) and 3001 (Express SRE API server)
EXPOSE 3000
EXPOSE 3001

# Launch the concurrent microservices
CMD ["pnpm", "run", "dev"]