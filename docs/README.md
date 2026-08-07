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
- Public catalog, categories, courses, and sessions
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
- HTTP contract: `docs/api/openapi.yaml`

## Keeping Postman current

When an endpoint, request body, parameter, authorization rule, or example
changes, update `docs/api/openapi.yaml` in the same work item and run:

```bash
npm run api:postman
npm run api:artifacts:check
```

The first command regenerates the organized collection and safe local
environment in `postman/`. The second compares all Express methods/paths with
OpenAPI and confirms that the checked-in Postman files exactly match the
contract. Generated JSON must not be hand-edited.

The running API exposes the raw artifacts at `/api/postman/collection` and
`/api/postman/environment`. They use `Cache-Control: no-store`, so URL imports
receive the currently generated files. The returned `baseUrl` is adjusted to
the request origin or optional `PUBLIC_API_URL` setting.

Every OpenAPI operation must declare `x-access` as `PUBLIC`, `AUTHENTICATED`,
`STUDENT`, `ADMIN`, or `SUPER_ADMIN`. The generator displays this as a request
name prefix, while the contract check rejects missing or contradictory access
metadata. This label documents authority; Express permission and ownership
checks remain the actual security boundary. `ADMIN` is rendered explicitly as
`[ADMIN + SUPER ADMIN]`, while `SUPER_ADMIN` is rendered as
`[SUPER ADMIN ONLY]`.

Postman can also import the OpenAPI 3.0 file as a specification with a generated
collection and offer update suggestions when that specification changes. The
repository command remains the deterministic source for files committed with
the code.
