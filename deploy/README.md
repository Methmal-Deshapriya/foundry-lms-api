# Deployment files

## Local rehearsal

`docker-compose.rehearsal.yml` uses disposable placeholder values and binds the web/API only to `127.0.0.1`. It is safe for local deployment rehearsal and must not be copied to the VPS.

## Production

`compose.production.yml` is the GreenCloud topology. It publishes no host ports and uses a remotely managed Cloudflare Tunnel for ingress.

The committed files under `env/` are templates only. On the VPS, copy them without the `.example` suffix to `/opt/foundry-lms/env`, replace every placeholder, and set mode `600`. Never add completed production env files to this repository.

The full setup, startup, verification, and rollback procedure is in `foundry_lms_docs/2026-10-06_greencloud_vps_setup_and_operations_runbook.md`.

