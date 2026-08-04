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

See `docs/README.md` for architecture and contribution rules.
