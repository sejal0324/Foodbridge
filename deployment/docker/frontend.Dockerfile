# syntax=docker/dockerfile:1
#
# FoodBridge web app: Vite build served by unprivileged nginx, which also
# reverse-proxies /api and /socket.io to the backend so the browser sees a
# single origin (required for the first-party refresh cookie).
#   docker build -f deployment/docker/frontend.Dockerfile -t foodbridge-frontend .

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
# Optional browser Maps key (public by nature; restrict it to your domain).
ARG VITE_GOOGLE_MAPS_BROWSER_API_KEY=
ENV VITE_GOOGLE_MAPS_BROWSER_API_KEY=${VITE_GOOGLE_MAPS_BROWSER_API_KEY}
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY deployment/configs/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/healthz"]
