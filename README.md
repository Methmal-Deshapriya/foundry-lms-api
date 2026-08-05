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
