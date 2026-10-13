#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "$#" -ne 4 ]]; then
  echo "Usage: deploy-release.sh <release-tag> <image-archive.gz> <compose-candidate> <rollback-script-candidate>" >&2
  exit 2
fi

release_tag="$1"
image_archive="$2"
compose_candidate="$3"
rollback_candidate="$4"

APP_DIR="${FOUNDRY_APP_DIR:-/opt/foundry-lms}"
ENV_DIR="${APP_DIR}/env"
INCOMING_DIR="${APP_DIR}/incoming"
DEPLOY_ENV_FILE="${ENV_DIR}/deploy.env"
COMPOSE_FILE="${APP_DIR}/compose.production.yml"
PREVIOUS_COMPOSE_FILE="${APP_DIR}/compose.production.previous.yml"
PREVIOUS_TAG_FILE="${APP_DIR}/previous-release-tag"
ROLLBACK_SCRIPT="${APP_DIR}/rollback-release.sh"
LOCK_FILE="${APP_DIR}/.deploy.lock"

if [[ ! "${release_tag}" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$ ]]; then
  echo "Invalid release tag: ${release_tag}" >&2
  exit 2
fi

for required in "${DEPLOY_ENV_FILE}" "${image_archive}" "${compose_candidate}" "${rollback_candidate}"; do
  if [[ ! -f "${required}" ]]; then
    echo "Required deployment file not found: ${required}" >&2
    exit 1
  fi
done

incoming_root="$(realpath "${INCOMING_DIR}")"
for candidate in "${image_archive}" "${compose_candidate}" "${rollback_candidate}"; do
  resolved="$(realpath "${candidate}")"
  case "${resolved}" in
    "${incoming_root}"/*) ;;
    *) echo "Refusing a deployment input outside ${incoming_root}: ${resolved}" >&2; exit 1 ;;
  esac
done

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

previous_tag="$(sed -n 's/^APP_TAG=//p' "${DEPLOY_ENV_FILE}" | tail -n 1 | tr -d '[:space:]')"
previous_release_available=0
if [[ "${previous_tag}" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$ ]] && \
  docker image inspect \
    "foundry-lms-api:${previous_tag}" \
    "foundry-lms-api-migrate:${previous_tag}" \
    "foundry-lms-web:${previous_tag}" >/dev/null 2>&1; then
  previous_release_available=1
fi
deployment_changed=0

rollback_after_error() {
  local exit_code=$?
  trap - ERR
  set +e

  echo "Deployment failed; attempting an application-only rollback." >&2
  if [[ "${deployment_changed}" -eq 1 && "${previous_release_available}" -eq 1 && "${previous_tag}" != "${release_tag}" ]]; then
    rollback_ok=1
    if [[ -f "${PREVIOUS_COMPOSE_FILE}" ]]; then
      install -m 0644 "${PREVIOUS_COMPOSE_FILE}" "${COMPOSE_FILE}" || rollback_ok=0
    fi
    write_app_tag "${previous_tag}" || rollback_ok=0
    docker compose --env-file "${DEPLOY_ENV_FILE}" -f "${COMPOSE_FILE}" \
      up -d --no-deps --force-recreate api || rollback_ok=0
    wait_for_node_url api http://127.0.0.1:5000/api/ready API || rollback_ok=0
    docker compose --env-file "${DEPLOY_ENV_FILE}" -f "${COMPOSE_FILE}" \
      up -d --no-deps --force-recreate web || rollback_ok=0
    wait_for_node_url web http://127.0.0.1:3000/sign-in Website || rollback_ok=0
    if [[ "${rollback_ok}" -eq 1 ]]; then
      echo "Previous application release ${previous_tag} was restored. Database migrations were not reversed." >&2
    else
      echo "Automatic rollback was attempted but did not become healthy. Database migrations were not reversed; manual recovery or a fix-forward release is required." >&2
    fi
  else
    echo "No earlier application release was available for rollback." >&2
  fi

  exit "${exit_code}"
}
trap rollback_after_error ERR

# Validate the new infrastructure file before replacing the current one.
APP_TAG="${release_tag}" FOUNDRY_ENV_DIR="${ENV_DIR}" \
  docker compose --env-file "${DEPLOY_ENV_FILE}" -f "${compose_candidate}" config --quiet

echo "Loading release images for ${release_tag}."
gzip -dc "${image_archive}" | docker load
for image in \
  "foundry-lms-api:${release_tag}" \
  "foundry-lms-api-migrate:${release_tag}" \
  "foundry-lms-web:${release_tag}"; do
  docker image inspect "${image}" >/dev/null
done

if [[ -f "${COMPOSE_FILE}" ]]; then
  install -m 0644 "${COMPOSE_FILE}" "${PREVIOUS_COMPOSE_FILE}"
fi
install -m 0644 "${compose_candidate}" "${COMPOSE_FILE}"
install -m 0750 "${rollback_candidate}" "${ROLLBACK_SCRIPT}"

if [[ "${previous_release_available}" -eq 1 && "${previous_tag}" != "${release_tag}" ]]; then
  printf '%s\n' "${previous_tag}" > "${PREVIOUS_TAG_FILE}"
  chmod 600 "${PREVIOUS_TAG_FILE}"
fi

write_app_tag "${release_tag}"
deployment_changed=1

compose=(docker compose --env-file "${DEPLOY_ENV_FILE}" -f "${COMPOSE_FILE}")

# The DB already exists in routine deployments; on the first deploy this
# starts it and waits for its health check before migrations run.
"${compose[@]}" pull db cloudflared
"${compose[@]}" up -d db

echo "Applying forward-only database migrations."
"${compose[@]}" run --rm migrate

"${compose[@]}" up -d --no-deps --force-recreate api
wait_for_node_url api http://127.0.0.1:5000/api/ready API

"${compose[@]}" up -d --no-deps --force-recreate web
wait_for_node_url web http://127.0.0.1:3000/sign-in Website

# Start it on the first deploy; leave the existing container untouched when
# its image/configuration did not change.
"${compose[@]}" up -d --no-deps cloudflared

trap - ERR

rm -f "$(realpath "${image_archive}")" "$(realpath "${compose_candidate}")" "$(realpath "${rollback_candidate}")"

# Keep the current and immediately previous application releases. Removal is
# best-effort because Docker correctly refuses to delete an image still used
# by a container.
for repository in foundry-lms-api foundry-lms-api-migrate foundry-lms-web; do
  while IFS= read -r old_tag; do
    [[ -z "${old_tag}" || "${old_tag}" == "<none>" ]] && continue
    [[ "${old_tag}" == "${release_tag}" || "${old_tag}" == "${previous_tag}" ]] && continue
    docker image rm "${repository}:${old_tag}" >/dev/null 2>&1 || true
  done < <(docker image ls "${repository}" --format '{{.Tag}}')
done

echo "Release ${release_tag} deployed successfully."
