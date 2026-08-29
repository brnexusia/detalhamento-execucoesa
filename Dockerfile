# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runner
ENV NODE_ENV=production
ENV PORT=80
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=builder /app/dist ./dist
COPY server ./server
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "--import", "./server/performance-hooks.mjs", "--import", "./server/api-json-hooks.mjs", "--import", "./server/analytics-features-hooks.mjs", "--import", "./server/catalog-order-lock-fix.mjs", "--import", "./server/catalog-features-hooks.mjs", "--import", "./server/business-features-hooks.mjs", "--import", "./server/platform-hooks.mjs", "--import", "./server/scanner-hooks.mjs", "--import", "./server/scanner-publish-hooks.mjs", "--import", "./server/public-protection-hooks.mjs", "server/app.mjs"]
