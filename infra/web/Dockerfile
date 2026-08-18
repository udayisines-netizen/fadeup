# FadeUp web — production image.
#
# Replaces `vite preview`, which was serving the public site. Vite's preview
# server is a development convenience: single Node process, no restart
# policy, no healthcheck, and explicitly documented upstream as not intended
# for production. It also meant the served bundle was whatever happened to be
# in dist/ when somebody last ran a build by hand — the audit found the live
# site running a build five days older than the working tree.
#
# Two stages so the runtime image contains no source, no node_modules and no
# build toolchain: only static files and nginx.

# ---------------------------------------------------------------------------
# Stage 1 — build
# ---------------------------------------------------------------------------
FROM node:22-alpine AS build

WORKDIR /app

# Copy manifests first so `npm ci` is cached independently of source changes.
COPY package.json package-lock.json* ./
RUN npm ci

COPY . .

# VITE_* values are compiled INTO the bundle, so they must be present at
# build time rather than at run time. They are public by definition — the
# Supabase URL and the anon key, both of which every visitor's browser
# receives anyway, and both of which are useless without RLS letting them
# through. No service_role key, no provider secret, and no SMTP credential
# is ever passed here; those live server-side in GoTrue and the worker.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY

RUN npm run build

# ---------------------------------------------------------------------------
# Stage 2 — serve
# ---------------------------------------------------------------------------
FROM nginx:1.27-alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Used by the compose healthcheck. Static, so it answers even if something
# is wrong with the app bundle itself — which is the point: it proves the
# SERVER is up, and the SPA fallback below proves routing works.
RUN printf '{"status":"ok"}' > /usr/share/nginx/html/healthz

EXPOSE 8080

# wget is already in nginx:alpine (busybox). No extra layer needed.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
