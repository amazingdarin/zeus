ARG NODE_IMAGE=node:22-alpine
FROM ${NODE_IMAGE}

WORKDIR /workspace

RUN corepack enable

# Install workspace dependencies with lockfile first for better layer cache.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/app-backend/package.json apps/app-backend/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/plugin-sdk-shared/package.json packages/plugin-sdk-shared/package.json
COPY packages/plugin-sdk-backend/package.json packages/plugin-sdk-backend/package.json
COPY packages/doc-editor/package.json packages/doc-editor/package.json

RUN pnpm install --filter ./apps/app-backend... --frozen-lockfile

# Copy runtime source files used by app-backend and its workspace deps.
COPY apps/app-backend apps/app-backend
COPY packages/shared packages/shared
COPY packages/plugin-sdk-shared packages/plugin-sdk-shared
COPY packages/plugin-sdk-backend packages/plugin-sdk-backend
COPY packages/doc-editor packages/doc-editor

WORKDIR /workspace/apps/app-backend

ENV NODE_ENV=production
EXPOSE 4870

CMD ["node", "--import", "tsx", "src/index.ts"]
