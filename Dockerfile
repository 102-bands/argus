# One image for Railway: build the web app, then serve it and the API from one uvicorn process.
# Built from the repo root, so Railway needs no root-directory setting.

FROM node:22-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
# Umami Cloud website ID (public, it appears in every page). A Railway variable with the same name overrides it.
ARG VITE_UMAMI_WEBSITE_ID=8113f1e3-a14d-40f3-9089-2afb9055dc47
ARG VITE_SITE_DOMAIN=argus102.space
RUN npm run build \
 && find dist -type f \( -name '*.js' -o -name '*.css' -o -name '*.html' -o -name '*.json' -o -name '*.svg' \
      -o -name '*.bin' -o -name '*.wasm' -o -name '*.map' \) -size +1k -exec gzip -k -9 {} +

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PYTHONUTF8=1 \
    UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PROJECT_ENVIRONMENT=/opt/venv
COPY --from=ghcr.io/astral-sh/uv:0.5.11 /uv /usr/local/bin/uv

WORKDIR /srv
COPY api/pyproject.toml api/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY api/argus ./argus
COPY api/scripts ./scripts
COPY --from=web /web/dist /srv/web

# Non-root user. With a Railway volume at /data, set RAILWAY_RUN_UID=0 if the mount isn't writable.
RUN useradd --uid 10001 --no-create-home argus && mkdir -p /data && chown argus /data
USER argus
ENV PATH=/opt/venv/bin:$PATH CACHE_DIR=/data WEB_DIR=/srv/web PORT=8000
EXPOSE 8000
# 0.0.0.0: Railway routes public traffic and health checks over IPv4 ("::" failed to respond there).
CMD ["sh", "-c", "uvicorn argus.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*' --no-server-header"]
