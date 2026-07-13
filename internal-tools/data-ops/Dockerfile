# Build context is the REPO ROOT (see docker-compose.yml) so we can copy the
# API code and reuse its ingestion functions directly.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    POETRY_VIRTUALENVS_CREATE=false \
    POETRY_NO_INTERACTION=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential libpq-dev \
    && rm -rf /var/lib/apt/lists/*

RUN pip install "poetry>=1.8"

WORKDIR /srv

# Install the API's runtime dependencies (main group only) so `import app.*`
# works — this is how we reuse resync_google_place et al.
COPY api/pyproject.toml api/poetry.lock ./api/
RUN cd api && poetry install --only main --no-root

# The reused API code + this tool's code.
COPY api/app ./api/app
COPY internal-tools/data-ops/ops ./ops

# `app` (the API package) lives under /srv/api; `ops` (this tool) under /srv.
ENV PYTHONPATH=/srv/api:/srv

EXPOSE 8090
