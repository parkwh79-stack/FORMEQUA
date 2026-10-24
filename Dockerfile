FROM node:22-bookworm-slim AS node-runtime
FROM python:3.12-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends libstdc++6 ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 BIND_HOST=0.0.0.0 PORT=8080
WORKDIR /app
COPY requirements.txt requirements-cloud.txt ./
RUN pip install --no-cache-dir -r requirements-cloud.txt \
    && useradd --uid 10001 --create-home formequa
COPY . /app
USER formequa
CMD ["gunicorn", "--config", "gunicorn.conf.py", "cloud_app:create_app()"]
