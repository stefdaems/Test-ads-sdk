# syntax=docker/dockerfile:1
#
# Container image for the Ads SDK device-harness manager (and build job).
# Build context is the device-harness/ directory:
#
#   docker build -f deploy/Dockerfile -t adsdk-device-harness:latest .
#
FROM node:18-alpine

WORKDIR /app

# Install production dependencies first for better layer caching.
COPY package.json ./
RUN npm install --omit=dev

# Copy the harness source (app, manager, shared modules, scripts).
COPY . .

# Shared build/artifact store — mount a shared volume (PVC) here on a cluster so
# every manager replica serves the same builds and devices install from one place.
ENV ARTIFACTS_DIR=/artifacts \
    HOST=0.0.0.0 \
    PORT=8090 \
    MQTT_PORT=1883
RUN mkdir -p /artifacts
VOLUME ["/artifacts"]

# HTTP (dashboard, app, REST API, MQTT-over-WebSocket) + MQTT over TCP.
EXPOSE 8090 1883

CMD ["node", "manager/server.js"]
