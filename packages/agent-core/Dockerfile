FROM node:22-bookworm-slim

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/agent-core/package.json packages/agent-core/
COPY packages/agent-core packages/agent-core

RUN pnpm install --filter @investment-agent/agent-core --frozen-lockfile

WORKDIR /app/packages/agent-core

ENV PORT=4000
EXPOSE 4000

CMD ["pnpm", "serve"]
