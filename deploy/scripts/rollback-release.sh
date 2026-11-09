#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${FOUNDRY_APP_DIR:-/opt/foundry-lms}"
ENV_DIR="${APP_DIR}/env"
DEPLOY_ENV_FILE="${ENV_DIR}/deploy.env"
COMPOSE_FILE="${APP_DIR}/compose.production.yml"
PREVIOUS_COMPOSE_FILE="${APP_DIR}/compose.production.previous.yml"
PREVIOUS_TAG_FILE="${APP_DIR}/previous-release-tag"
LOCK_FILE="${APP_DIR}/.deploy.lock"

exec 9>"${LOCK_FILE}"
if ! flock -n 9; then
  echo "Another deployment or rollback is already running." >&2
  exit 1
fi

write_app_tag() {
  local tag="$1"
  local temporary
  temporary="$(mktemp "${ENV_DIR}/deploy.env.tmp.XXXXXX")"
  awk -v tag="${tag}" '
    BEGIN { replaced = 0 }
    /^APP_TAG=/ { print "APP_TAG=" tag; replaced = 1; next }
    { print }
    END { if (!replaced) print "APP_TAG=" tag }
  ' "${DEPLOY_ENV_FILE}" > "${temporary}"
  chmod 600 "${temporary}"
  mv -f "${temporary}" "${DEPLOY_ENV_FILE}"
}

wait_for_node_url() {
  local service="$1"
  local url="$2"
  local label="$3"

  for attempt in $(seq 1 40); do
    if docker compose --env-file "${DEPLOY_ENV_FILE}" -f "${COMPOSE_FILE}" \
      exec -T "${service}" node -e \
      "fetch('${url}').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
      echo "${label} is ready."
      return 0
    fi
    sleep 3
  done

  echo "${label} did not become ready within 120 seconds." >&2
  return 1
}

if [[ ! -s "${PREVIOUS_TAG_FILE}" ]]; then
  echo "No previous release tag is recorded; automatic rollback is unavailable." >&2
  exit 1
fi

previous_tag="$(tr -d '[:space:]' < "${PREVIOUS_TAG_FILE}")"
if [[ ! "${previous_tag}" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$ ]]; then
  echo "The recorded previous release tag is invalid." >&2
  exit 1
fi

for image in \
  "foundry-lms-api:${previous_tag}" \
  "foundry-lms-api-migrate:${previous_tag}" \
  "foundry-lms-web:${previous_tag}"; do
  docker image inspect "${image}" >/dev/null
done

if [[ -f "${PREVIOUS_COMPOSE_FILE}" ]]; then
  install -m 0644 "${PREVIOUS_COMPOSE_FILE}" "${COMPOSE_FILE}"
fi

write_app_tag "${previous_tag}"

echo "Rolling the application containers back to ${previous_tag}."
docker compose --env-file "${DEPLOY_ENV_FILE}" -f "${COMPOSE_FILE}" \
  up -d --no-deps --force-recreate api
wait_for_node_url api http://127.0.0.1:5000/api/ready API

docker compose --env-file "${DEPLOY_ENV_FILE}" -f "${COMPOSE_FILE}" \
  up -d --no-deps --force-recreate web
wait_for_node_url web http://127.0.0.1:3000/sign-in Website

echo "Application rollback completed. Database migrations were not reversed."

