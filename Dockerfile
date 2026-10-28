FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
    && mkdir -p /var/lib/shoof \
    && chown node:node /var/lib/shoof \
    && chmod 700 /var/lib/shoof
COPY --chown=node:node src ./src
COPY --chown=node:node web ./web
COPY --chown=node:node tools/runtime.mjs tools/import-report.mjs tools/read-google-ads.mjs ./tools/
USER node
ENV REPORTING_BIND=0.0.0.0 REPORTING_PORT=8080 REPORTING_STATE_DIR=/var/lib/shoof
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "--input-type=module", "-e", "try { const r = await fetch('http://127.0.0.1:' + process.env.REPORTING_PORT + '/healthz', {signal: AbortSignal.timeout(3000)}); process.exit(r.status === 200 ? 0 : 1); } catch { process.exit(1); }"]
CMD ["node", "tools/runtime.mjs"]
