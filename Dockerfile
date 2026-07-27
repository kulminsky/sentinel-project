FROM node:20.19-bookworm-slim AS sentinel-dependencies

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts \
    && npm cache clean --force

FROM sentinel-dependencies AS sentinel-build

COPY tsconfig.json ./
COPY src ./src
COPY tests ./tests
RUN npm run build

FROM node:20.19-bookworm-slim AS sample-build

WORKDIR /app

COPY sample-app/package.json sample-app/package-lock.json ./
RUN npm ci --ignore-scripts \
    && npm cache clean --force

COPY sample-app/tsconfig.json ./
COPY sample-app/src ./src
COPY sample-app/tests ./tests
RUN npm run build

FROM node:20.19-bookworm-slim AS sample-app

ENV NODE_ENV=production

WORKDIR /app

COPY sample-app/package.json sample-app/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
    && npm cache clean --force

COPY --from=sample-build /app/dist/src ./dist/src
COPY sample-app/public ./public
COPY sample-app/openapi.json ./

USER node

ENTRYPOINT ["node", "/app/dist/src/server.js"]

FROM sentinel-dependencies AS sentinel

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

RUN npx playwright install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/*

COPY --from=sentinel-build /app/dist/src ./dist/src

RUN mkdir -p /scan

WORKDIR /scan

ENTRYPOINT ["node", "/app/dist/src/cli.js"]
