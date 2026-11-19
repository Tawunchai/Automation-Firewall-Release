#!/bin/sh
# Picks the nginx config at container start: HTTPS when a certificate is mounted, plain HTTP when
# it is not.
#
# The choice is made here rather than baked at build time so the SAME image runs on a laptop
# (localhost, no certificate needed) and on the company VM (reached by IP, where the AI Assistant's
# microphone requires a secure context). Nothing has to be rebuilt to turn TLS on — mount the certs
# and restart.
set -e

CERT=/etc/nginx/certs/server.crt
KEY=/etc/nginx/certs/server.key
TARGET=/etc/nginx/conf.d/default.conf

# The port the HTTPS listener is published as on the HOST. nginx only ever sees 443 inside the
# container, so it cannot work this out itself — and a redirect to the wrong port is a dead link.
PUBLIC_HTTPS_PORT="${PUBLIC_HTTPS_PORT:-443}"
if [ "$PUBLIC_HTTPS_PORT" = "443" ]; then
  PORT_SUFFIX=""
else
  PORT_SUFFIX=":$PUBLIC_HTTPS_PORT"
fi

if [ -r "$CERT" ] && [ -r "$KEY" ]; then
  sed "s/__PORT_SUFFIX__/$PORT_SUFFIX/g" /etc/nginx/templates/https.conf > "$TARGET"
  echo "[entrypoint] TLS certificate found — serving HTTPS on 443 (published as ${PUBLIC_HTTPS_PORT}),"
  echo "[entrypoint] redirecting plain HTTP to https://<host>${PORT_SUFFIX}/"
  # Print the names the certificate is valid for. A certificate whose SAN does not list the IP
  # people actually type is the single most common reason this ends up "still not working".
  if command -v openssl >/dev/null 2>&1; then
    echo "[entrypoint] certificate is valid for:"
    openssl x509 -in "$CERT" -noout -ext subjectAltName 2>/dev/null | sed 's/^/[entrypoint]   /'
    echo "[entrypoint] expires: $(openssl x509 -in "$CERT" -noout -enddate | cut -d= -f2)"
  fi
else
  cp /etc/nginx/templates/http.conf "$TARGET"
  echo "[entrypoint] no TLS certificate at $CERT — serving plain HTTP on 80"
  echo "[entrypoint] NOTE: the AI Assistant's voice input needs HTTPS unless you open the app"
  echo "[entrypoint]       on localhost. See the HTTPS section of README.md to generate a certificate."
fi

exec "$@"
