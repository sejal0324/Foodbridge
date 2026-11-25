# syntax=docker/dockerfile:1
#
# FoodBridge AI service (Python 3.12 + FastAPI).
#
# Build context is ai-service/ (see ai-service/.dockerignore):
#   cd ai-service
#   docker build -f ../deployment/docker/ai-service.Dockerfile -t foodbridge-ai:dev .
#
# The image ships the trained artifact in app/models/artifacts/; it never retrains.
# Configuration comes from environment variables (INTERNAL_SERVICE_TOKEN is required).

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /srv/ai-service

RUN groupadd --system --gid 10001 foodbridge \
    && useradd --system --uid 10001 --gid foodbridge --no-create-home \
       --shell /usr/sbin/nologin foodbridge

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

USER foodbridge
EXPOSE 8001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["python", "-c", "import sys, urllib.request; r = urllib.request.urlopen('http://127.0.0.1:8001/ai/health', timeout=4); sys.exit(0 if r.status == 200 else 1)"]

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
