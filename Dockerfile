# Update server. Node 24 runs the TypeScript sources directly (type stripping), so there is no build step.
FROM node:24-alpine
WORKDIR /app
RUN npm install -g pnpm@9.15.9 && mkdir /data && chown node:node /data
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --prod --filter "@passforge/server..."
COPY packages/core/src packages/core/src
COPY apps/server/src apps/server/src
USER node
ENV NODE_ENV=production DATA_DIR=/data PORT=8080
VOLUME /data
EXPOSE 8080
HEALTHCHECK CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "apps/server/src/main.ts"]
