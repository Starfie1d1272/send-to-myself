# SendToMyself —— 单容器部署（API 同时托管前端静态资源），SPEC §12.1 / §21。
# 原生依赖（better-sqlite3 / argon2 / sharp）在构建阶段按目标架构编译，
# 因此同一镜像可在 amd64 / arm64（含多数 NAS）上原生运行。

# ---------- build ----------
FROM node:24.21.0-bookworm-slim AS build
RUN corepack enable && apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
COPY apps/web ./apps/web

RUN pnpm install --frozen-lockfile --filter @sendtomyself/api... --filter @sendtomyself/web...
ARG BUILD_REVISION
ENV BUILD_REVISION=$BUILD_REVISION
RUN pnpm --filter @sendtomyself/web build
RUN pnpm --filter @sendtomyself/api deploy --prod --legacy /out/api

# ---------- runtime ----------
FROM node:24.21.0-bookworm-slim AS runtime
WORKDIR /app/apps/api
ARG BUILD_REVISION
ENV NODE_ENV=production BUILD_REVISION=$BUILD_REVISION

# 仅复制 API 生产闭包及同一提交构建的 Web
COPY --from=build /out/api /app/apps/api
COPY --from=build /app/apps/web/dist /app/apps/web/dist

# 数据与附件落盘到挂载卷；前端由 API 直接托管
ENV DB_PATH=/data/app.db \
    STORAGE_ROOT=/data/uploads \
    WEB_DIST=/app/apps/web/dist \
    PORT=8787
VOLUME ["/data"]
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=4s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# 使用已安装的 tsx，容器启动时无需再联网下载 pnpm。
CMD ["node", "--import", "tsx", "src/index.ts"]
