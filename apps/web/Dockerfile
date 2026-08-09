# fadeup-web — production static build served by nginx
# No secrets are baked into this image: only public VITE_* build args are
# ever consumed, and Vite only exposes VITE_-prefixed variables to the client.

FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_SUPABASE_URL=${VITE_SUPABASE_URL}
ENV VITE_SUPABASE_ANON_KEY=${VITE_SUPABASE_ANON_KEY}

RUN npm run build

FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

RUN printf '#!/bin/sh\nwget -q -O- http://127.0.0.1:8080/health.json || exit 1\n' > /usr/local/bin/healthcheck.sh && \
  chmod +x /usr/local/bin/healthcheck.sh

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD /usr/local/bin/healthcheck.sh

CMD ["nginx", "-g", "daemon off;"]
