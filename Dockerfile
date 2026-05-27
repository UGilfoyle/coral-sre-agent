# ==========================================
# 🐚 Coral AI Bot — SRE Container Runtime
# ==========================================

FROM node:20-bookworm-slim

ENV NODE_ENV=production
ENV PATH="/root/.local/bin:/usr/local/bin:${PATH}"

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    jq \
    git \
    unzip \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://withcoral.com/install.sh | sh

RUN npm install -g pnpm

WORKDIR /app

COPY package.json pnpm-lock.yaml tsconfig.json vite.config.ts ./
RUN pnpm install --frozen-lockfile

COPY src ./src
COPY coral-sources ./coral-sources
COPY scripts ./scripts
COPY index.html ./

RUN pnpm run build

EXPOSE 10000

CMD ["bash", "scripts/render-start.sh"]
