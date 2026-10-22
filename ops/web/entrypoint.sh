#!/bin/sh
set -eu

fail() {
  printf '%s\n' 'Invalid or missing production Web configuration' >&2
  exit 1
}

# This package accepts canonical lowercase DNS/IPv4 origins, optionally with a
# non-default port. Restrict the substituted value to nginx-safe authority text.
case "${APP_ORIGIN-}" in
  https://*) authority=${APP_ORIGIN#https://} ;;
  *) fail ;;
esac
case "$authority" in
  ''|*[!a-z0-9.:-]*) fail ;;
esac
case "$authority" in
  *:*)
    hostname=${authority%:*}
    port=${authority##*:}
    case "$hostname" in *:*) fail ;; esac
    case "$port" in ''|0*|*[!0-9]*) fail ;; esac
    [ "${#port}" -le 5 ] && [ "$port" -le 65535 ] && [ "$port" -ne 443 ] || fail
    ;;
  *) hostname=$authority ;;
esac
[ "${#hostname}" -le 253 ] || fail
printf '%s\n' "$hostname" | grep -Eq '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$' || fail
[ -r /run/secrets/tls_certificate ] && [ -s /run/secrets/tls_certificate ] || fail
[ -r /run/secrets/tls_private_key ] && [ -s /run/secrets/tls_private_key ] || fail

export SCB_PUBLIC_AUTHORITY="$authority"
umask 077
mkdir -p /tmp/scb-nginx/client /tmp/scb-nginx/proxy /tmp/scb-nginx/fastcgi /tmp/scb-nginx/uwsgi /tmp/scb-nginx/scgi
# Deliberately preserve nginx's $uri, $remote_addr and other runtime variables.
envsubst '${SCB_PUBLIC_AUTHORITY}' < /opt/scb/nginx.conf.template > /tmp/scb-nginx/nginx.conf
exec nginx -c /tmp/scb-nginx/nginx.conf -g 'daemon off;'
