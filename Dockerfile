FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.28.1 --activate
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml tsconfig*.json ./
COPY packages/shared ./packages/shared
COPY apps/server ./apps/server
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @verso/shared build && pnpm --filter server build

FROM node:22-alpine
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.28.1 --activate
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml ./
COPY packages/shared ./packages/shared
COPY apps/server/package.json ./apps/server/
RUN pnpm install --prod
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/apps/server/dist ./apps/server/dist
COPY apps/server/migrations ./apps/server/migrations
RUN mkdir -p /data/files && chown -R node:node /data/files
USER node
WORKDIR /app/apps/server
# Apply pending database migrations (idempotent, lock-protected) before serving.
# Without this, schema changes never reached the hosted database.
ENV MIGRATE_ON_START=true
# Uploads are staged here before going to storage. Without it the server tried to
# create ./data inside /app, which the node user can't write: every upload failed.
ENV FILES_DIR=/data/files
EXPOSE 8080
CMD ["node", "dist/server.js"]
