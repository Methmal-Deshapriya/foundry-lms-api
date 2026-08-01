# Foundry LMS API Architecture

This directory contains the current backend development contract. Historical planning documents and pre-migration API examples were removed because the running code and Prisma migrations have superseded them.

## Request flow

Every domain follows:

```text
Route -> Controller -> Service -> Repository -> Prisma -> PostgreSQL
```

- Routes define paths and attach authentication and role middleware.
- Controllers translate HTTP input/output and call services.
- Services own validation, business rules, resource authorization, and audit orchestration.
- Repositories own Prisma queries.
- Models and transformers shape safe API responses.
- Shared errors and response envelopes live in `src/utils`.

Do not query Prisma from routes, controllers, or services. Do not place business rules in repositories.

## Implemented domains

- Authentication, email verification, and password recovery
- Users and profile management
- Bootcamps and sessions
- Enrollments, payment status, and derived progress
- Certificates and public verification
- Student projects, review, and public showcase data
- Audit logs

## Authorization

Authentication uses the HTTP-only `token` JWT cookie. Role middleware is only the first authorization layer. Student resources must also enforce enrollment or ownership access in the service layer.

## API response envelope

```json
{ "success": true, "data": {}, "message": "..." }
```

```json
{ "success": false, "error": "...", "code": "ERROR_CODE", "field": "optional" }
```

## Source of truth

- Data model: `prisma/schema.prisma` and `prisma/migrations`
- Routes: `src/routes/v1`
- Validation: `src/constants/v1/**/*.schema.js`
- Business rules: `src/services/v1`

Postman collections or endpoint documentation must be generated from the current routes and validation schemas rather than copied from removed historical specifications.
