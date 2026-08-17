# Railway-friendly frontend image: build context is frontend/ itself
# (Railway service "Root Directory" = frontend/, auto-detects this file).
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1

# NEXT_PUBLIC_* vars are inlined at build time, so the backend URL must be
# supplied as a Railway "build-time variable" (mapped to this ARG), not just
# a runtime env var.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY healthcheck.js ./healthcheck.js

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD node healthcheck.js

# Next's standalone server reads $PORT itself (defaults to 3000), so Railway's
# injected PORT is picked up automatically — no hardcoded ENV PORT here.
CMD ["node", "server.js"]
