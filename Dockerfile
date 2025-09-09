## syntax=docker/dockerfile:1
# Minimal, production-ready image for LiveKit Agent API + Agent worker

FROM node:22-slim AS build
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app

# Install dependencies using lockfile only
COPY pnpm-lock.yaml package.json ./
# Use non-frozen install to avoid lockfile/overrides mismatch on Railway builders
RUN ONNXRUNTIME_NODE_INSTALL=skip pnpm install --no-frozen-lockfile

# Copy source and build
COPY tsconfig.json ./
COPY src ./src
RUN pnpm run build

# Prune dev dependencies for runtime
RUN pnpm prune --prod


FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Copy production node_modules and built dist only
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

EXPOSE 8081
CMD ["node", "dist/index.js"]