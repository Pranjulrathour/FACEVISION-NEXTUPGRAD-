# Railway-friendly backend image: build context is backend/ itself
# (Railway service "Root Directory" = backend/, auto-detects this file).
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD python healthcheck.py || exit 1

# run.py reads HOST/PORT/RELOAD from the environment, so this works both
# locally (.env) and on Railway (injected PORT).
CMD ["python", "run.py"]
