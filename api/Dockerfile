FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PYTHONUTF8=1 \
    UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PROJECT_ENVIRONMENT=/opt/venv
COPY --from=ghcr.io/astral-sh/uv:0.5.11 /uv /usr/local/bin/uv

WORKDIR /srv
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY argus ./argus
COPY scripts ./scripts

# Non-root user. On Railway, set RAILWAY_RUN_UID=0 only if the volume mount needs it (PRD §11.4).
RUN useradd --uid 10001 --no-create-home argus && mkdir -p /data && chown argus /data
USER argus
ENV PATH=/opt/venv/bin:$PATH CACHE_DIR=/data PORT=8000
EXPOSE 8000
CMD ["sh", "-c", "uvicorn argus.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*' --no-server-header"]
