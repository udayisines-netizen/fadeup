# FadeUp Prospect Worker V2 — production image.
# Multi-stage: build with devDependencies, ship only the compiled dist/ +
# production node_modules. Runs as a non-root user.

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist

# Model artifacts live on a mounted volume, not in the image: they are
# produced by ml/train.py against real outcome data, are environment
# specific, and must survive a rebuild. Inference refuses to load an
# artifact whose registry path falls outside this directory.
RUN mkdir -p /app/ml-artifacts

RUN groupadd --system fadeup && useradd --system --gid fadeup --home-dir /app fadeup \
  && chown -R fadeup:fadeup /app
USER fadeup

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node dist/healthcheck.js || exit 1

CMD ["node", "dist/index.js"]
