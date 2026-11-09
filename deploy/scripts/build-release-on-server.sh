#!/usr/bin/env bash
set -Eeuo pipefail

# Builds the three release images natively on the production server (Oracle
# Ampere A1 is ARM64, so images built on a GitHub x86 runner would not run),
# then hands over to deploy-release.sh for migrations, startup, health checks
# and rollback.
#
# Inputs are two source archives made with `git archive` (the deploy workflow
# makes them from the exact tested commits; for a manual release, make them
# on your PC the same way). The server therefore never needs GitHub access.
#
# Usage: build-release-on-server.sh <release-tag> <server-src.tar.gz> <client-src.tar.gz>
#
# Non-secret website build values (NEXT_PUBLIC_*) come from
# ${APP_DIR}/env/web-build.env; see deploy/env/web-build.env.example.

if [[ "$#" -ne 3 ]]; then
  echo "Usage: build-release-on-server.sh <release-tag> <server-src.tar.gz> <client-src.tar.gz>" >&2
  exit 2
fi

release_tag="$1"
server_archive="$2"
client_archive="$3"

APP_DIR="${FOUNDRY_APP_DIR:-/opt/foundry-lms}"
ENV_DIR="${APP_DIR}/env"
INCOMING_DIR="${APP_DIR}/incoming"
WEB_BUILD_ENV="${ENV_DIR}/web-build.env"
BUILD_LOCK="${APP_DIR}/.build.lock"

if [[ ! "${release_tag}" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$ ]]; then
  echo "Invalid release tag: ${release_tag}" >&2
  exit 2
fi

incoming_root="$(realpath "${INCOMING_DIR}")"
for archive in "${server_archive}" "${client_archive}"; do
  [[ -f "${archive}" ]] || { echo "Source archive not found: ${archive}" >&2; exit 1; }
  case "$(realpath "${archive}")" in
    "${incoming_root}"/*) ;;
    *) echo "Refusing a source archive outside ${incoming_root}: ${archive}" >&2; exit 1 ;;
  esac
done
[[ -f "${WEB_BUILD_ENV}" ]] || { echo "Website build settings not found: ${WEB_BUILD_ENV}" >&2; exit 1; }

exec 8>"${BUILD_LOCK}"
if ! flock -n 8; then
  echo "Another release build is already running." >&2
  exit 1
fi

# Read only the three expected keys; never `source` the file.
read_build_value() {
  sed -n "s/^$1=//p" "${WEB_BUILD_ENV}" | tail -n 1 | sed 's/^"//; s/"$//'
}
NEXT_PUBLIC_API_BASE_URL="$(read_build_value NEXT_PUBLIC_API_BASE_URL)"
NEXT_PUBLIC_IMAGE_ORIGINS="$(read_build_value NEXT_PUBLIC_IMAGE_ORIGINS)"
NEXT_PUBLIC_R2_ACCOUNT_ID="$(read_build_value NEXT_PUBLIC_R2_ACCOUNT_ID)"
for name in NEXT_PUBLIC_API_BASE_URL NEXT_PUBLIC_IMAGE_ORIGINS NEXT_PUBLIC_R2_ACCOUNT_ID; do
  [[ -n "${!name}" ]] || { echo "${name} is missing from ${WEB_BUILD_ENV}" >&2; exit 1; }
done

build_dir="${INCOMING_DIR}/build-${release_tag}"
cleanup() { rm -rf "${build_dir}"; }
trap cleanup EXIT

rm -rf "${build_dir}"
mkdir -p "${build_dir}/server" "${build_dir}/client"
tar -xzf "${server_archive}" -C "${build_dir}/server"
tar -xzf "${client_archive}" -C "${build_dir}/client"

echo "Building release ${release_tag} for $(uname -m)."
export DOCKER_BUILDKIT=1
docker build --target runner -t "foundry-lms-api:${release_tag}" "${build_dir}/server"
docker build --target migrate -t "foundry-lms-api-migrate:${release_tag}" "${build_dir}/server"
docker build \
  --build-arg "NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}" \
  --build-arg "NEXT_PUBLIC_IMAGE_ORIGINS=${NEXT_PUBLIC_IMAGE_ORIGINS}" \
  --build-arg "NEXT_PUBLIC_R2_ACCOUNT_ID=${NEXT_PUBLIC_R2_ACCOUNT_ID}" \
  -t "foundry-lms-web:${release_tag}" "${build_dir}/client"

# deploy-release.sh only accepts its inputs from the incoming directory.
compose_candidate="${INCOMING_DIR}/compose.production.${release_tag}.yml"
rollback_candidate="${INCOMING_DIR}/rollback-release.${release_tag}.sh"
install -m 0644 "${build_dir}/server/deploy/compose.production.yml" "${compose_candidate}"
install -m 0750 "${build_dir}/server/deploy/scripts/rollback-release.sh" "${rollback_candidate}"
deploy_script="${build_dir}/server/deploy/scripts/deploy-release.sh"

bash "${deploy_script}" "${release_tag}" --images-present "${compose_candidate}" "${rollback_candidate}"

rm -f "$(realpath "${server_archive}")" "$(realpath "${client_archive}")"
# Keep the build cache from slowly filling the disk.
docker builder prune --force --filter until=168h >/dev/null 2>&1 || true
echo "Release ${release_tag} built and deployed on this server."
