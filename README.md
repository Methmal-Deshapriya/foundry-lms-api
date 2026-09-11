# Foundry LMS Server

Express and Prisma API for Foundry Academy's learning management system.

## Stack

- Node.js ESM and Express 5
- Prisma 7 with PostgreSQL and Prisma Accelerate
- Zod validation
- HTTP-only JWT authentication
- Nodemailer for OTP and password-reset email

## Local development

Copy `.env.example` to `.env`, configure the database, JWT, email, frontend URL,
CORS origin, and the catalog revalidation secret shared with the frontend, then run:

```bash
npm install
npm run dev
```

The default API address is `http://localhost:5000/api/v1`; health is available at `GET /api/health`.

## Production readiness

Production startup fails fast when required database, SMTP, OTP-HMAC, public
origin, or multi-instance Redis configuration is missing. Use `GET /api/ready`
for dependency-aware readiness; its response intentionally does not expose raw
provider errors.

For Prisma Accelerate deployments, configure PostgreSQL role timeouts once and
verify them during startup:

```bash
npm run db:configure-timeouts
```

Expired authentication artifacts are removed in bounded scheduled batches. An
operator can also trigger one batch manually:

```bash
npm run auth:cleanup
```

`RATE_LIMIT_REDIS_URL` is required when `API_INSTANCE_COUNT` is greater than
one. Redis connection attempts are bounded; an unavailable configured store
makes startup/readiness fail instead of silently falling back to per-process
rate limits.

## API contract and Postman

`docs/api/openapi.yaml` is the canonical HTTP contract. Generate the organized
Postman collection and local environment after changing the API contract:

```bash
npm run api:postman
```

Verify that every Express route is documented and the generated artifacts are
current:

```bash
npm run api:artifacts:check
```

Import both files from `postman/` into Postman and select the local environment.
Do not edit the generated collection directly; changes belong in the OpenAPI
contract so future regeneration cannot discard them.

With the API running, Postman can import the latest generated artifacts directly
from these URLs:

```text
http://localhost:5000/api/postman/collection
http://localhost:5000/api/postman/environment
```

See `docs/README.md` for architecture and contribution rules.

## Accepted audit durability limitation

Audit writes are currently best-effort and deliberately do not delay or roll
back the business operation that produced them. A failed audit insert is sent
to the server logger with an `AUDIT_FAILED` marker, but there is no transactional
outbox, durable queue, or automatic retry. Audit history is useful for
administration and troubleshooting, but it is not a guaranteed legal or
financial ledger. Revisit this decision before production requirements demand
lossless security or compliance evidence.
