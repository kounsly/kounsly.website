FROM nginx:alpine

# Static single-page site
COPY index.html /usr/share/nginx/html/index.html

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost/ >/dev/null 2>&1 || exit 1
