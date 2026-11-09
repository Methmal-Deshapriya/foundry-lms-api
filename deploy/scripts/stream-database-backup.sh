#!/usr/bin/env bash
set -Eeuo pipefail

# Streams a PostgreSQL custom-format dump to stdout. Status text must go to
# stderr because GitHub Actions redirects stdout directly into backup.dump.

APP_DIR="${FOUNDRY_APP_DIR:-/opt/foundry-lms}"
COMPOSE_FILE="${FOUNDRY_COMPOSE_FILE:-${APP_DIR}/compose.production.yml}"
# The special value "none" is useful for the local rehearsal Compose file,
# which has no production deploy.env. An unset value uses the VPS default.
DEPLOY_ENV_FILE="${FOUNDRY_DEPLOY_ENV_FILE-${APP_DIR}/env/deploy.env}"
if [[ "${DEPLOY_ENV_FILE}" == "none" ]]; then
  DEPLOY_ENV_FILE=""
fi

if [[ ! -f "${COMPOSE_FILE}" ]]; then
  echo "Compose file not found: ${COMPOSE_FILE}" >&2
  exit 1
fi

compose=(docker compose -f "${COMPOSE_FILE}")
if [[ -n "${DEPLOY_ENV_FILE}" ]]; then
  if [[ ! -f "${DEPLOY_ENV_FILE}" ]]; then
    echo "Deployment env file not found: ${DEPLOY_ENV_FILE}" >&2
    exit 1
  fi
  compose=(docker compose --env-file "${DEPLOY_ENV_FILE}" -f "${COMPOSE_FILE}")
fi

if ! "${compose[@]}" ps --status running --services | grep -qx db; then
  echo "The production database container is not running." >&2
  exit 1
fi

echo "Streaming a custom-format PostgreSQL dump from the private db container." >&2

exec "${compose[@]}" exec -T db sh -ceu '
  export PGPASSWORD="$POSTGRES_PASSWORD"
  exec pg_dump \
    --host=127.0.0.1 \
    --port=5432 \
    --username="$POSTGRES_USER" \
    --dbname="$POSTGRES_DB" \
    --format=custom \
    --no-owner \
    --no-privileges \
    --no-password
'
