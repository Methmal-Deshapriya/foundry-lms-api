# API Testing Context

This document is the default context for generating API tests in `foundry_lms_server_expressjs`.

Use it as the first reference before reading source files. Its purpose is to keep test generation consistent, low-token, and aligned with the current backend architecture.

## Project Snapshot

- Runtime: Node.js + Express
- Module system: ES Modules (`"type": "module"`)
- API base prefix: `/api/v1`
- Auth mechanism: JWT stored in HTTP-only `token` cookie
- Shared success helper: `src/utils/responseHandler.js`
- Shared error handler: `src/middlewares/errorHandler.js`
- App entry for tests: `src/app.js`
- Real server bootstrap: `src/index.js`

## Testing Stack

Tests should be written with:

- `vitest`
- `supertest`
- ES module syntax (`import`, not `require`)

Recommended install shape:

```json
{
  "devDependencies": {
    "vitest": "...",
    "supertest": "..."
  }
}
```

Example import style:

```js
import request from "supertest";
import app from "../../src/app.js";
```

## Testing Philosophy

- Test API behavior, not internal implementation details.
- Treat each route as a public contract: status code, response body, auth rules, and validation behavior matter most.
- Prefer integration-style API tests over heavy mocking.
- Mock only true external boundaries when needed.
- Verify what a client can observe.
- Do not assert controller/service internals, Prisma calls, or helper implementation details unless absolutely necessary.

## Recommended Test Structure

Recommended structure:

```txt
tests/
  auth/
    auth.test.js
  users/
    users.integration.test.js
  courses/
  bootcamps/
  enrollments/
  projects/
  setup/
    testApp.js
    testDb.js
    factories.js
    auth.js
```

Notes:

- Group tests by API module, not by technical layer.
- Put shared setup, factories, auth helpers, and database helpers under `tests/setup/`.
- Keep one test file focused on one resource or route family.

## File Naming Conventions

Preferred names:

- `auth.test.js`
- `users.test.js`
- `projects.test.js`
- `courses.integration.test.js`
- `bootcamps.integration.test.js`

Rules:

- Use `.test.js`.
- Use `.integration.test.js` when the suite clearly exercises full request flow plus database.
- Keep names predictable and module-based.

## App Import Rule

The codebase already separates the Express app from the running server:

- `src/app.js` creates and configures the Express app.
- `src/index.js` calls `app.listen(...)`.

Tests must import `src/app.js`.

Do this:

```js
import request from "supertest";
import app from "../../src/app.js";
```

Never do this in tests:

- import `src/index.js`
- call `listen()`
- start a real HTTP server manually

Reason: Supertest can exercise the Express app directly without opening a real port.

## Standard Response Conventions

### Success Response

Success responses are built by `ApiResponse.send(...)` and typically look like:

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "Jane Doe"
  },
  "message": "Success"
}
```

Notes:

- `data` is omitted only when `null` or `undefined`.
- `message` is usually route-specific.
- Some endpoints return `201` for creation, otherwise `200` is common.

### Validation Error

Validation failures use the global error shape:

```json
{
  "success": false,
  "error": "Invalid email format",
  "code": "VALIDATION_ERROR",
  "field": "email"
}
```

### Unauthorized Error

```json
{
  "success": false,
  "error": "Authentication required. Please log in.",
  "code": "UNAUTHORIZED"
}
```

### Forbidden Error

```json
{
  "success": false,
  "error": "Access denied. You do not have permission for this action.",
  "code": "FORBIDDEN"
}
```

### Not Found Error

```json
{
  "success": false,
  "error": "Resource not found",
  "code": "NOT_FOUND"
}
```

### Conflict Error

Common for duplicates or invalid state transitions:

```json
{
  "success": false,
  "error": "A user with this email already exists.",
  "code": "CONFLICT"
}
```

Important:

- Error bodies use `error`, not `message`.
- `details` may appear in development mode or for explicit validation details.
- Assert the stable contract first: status code, `success`, `code`, and key message content.

## Authentication Testing Guidelines

This project uses cookie-based authentication.

### Login Tests

When testing login:

- send valid credentials to `POST /api/v1/auth/login`
- assert `200`
- assert `success: true`
- assert safe user data is returned
- assert `set-cookie` includes the `token` cookie

Example pattern:

```js
const agent = request.agent(app);

const response = await agent.post("/api/v1/auth/login").send({
  email: "student@example.com",
  password: "Password123",
});

expect(response.status).toBe(200);
expect(response.body.success).toBe(true);
expect(response.headers["set-cookie"]).toBeDefined();
```

### Authenticated Requests

Prefer `request.agent(app)` so cookies persist across requests:

```js
const agent = request.agent(app);

await agent.post("/api/v1/auth/login").send(credentials);
const me = await agent.get("/api/v1/auth/me");
```

If not using an agent, manually pass the cookie from `set-cookie`.

### Role-Based Authorization Strategy

Use separate seeded or factory-created users for:

- `STUDENT`
- `ADMIN`
- `SUPER_ADMIN`

For protected routes, cover:

- unauthenticated request -> `401`
- authenticated wrong role -> `403`
- authenticated allowed role -> success

### Admin vs Student Scenarios

Examples:

- Student accessing admin-only user list should return `403`.
- Admin accessing admin routes should succeed.
- Only `SUPER_ADMIN` should be able to promote or demote users.
- Student-owned resources should reject access from unrelated users when service rules require ownership.

## Test Writing Standards

- Follow `Arrange / Act / Assert`.
- Use clear `describe` and `it` names based on behavior.
- Keep tests isolated and repeatable.
- Do not make tests depend on execution order.
- Avoid arbitrary sleeps and manual timeouts.
- Create only the minimum data needed for the scenario.
- Assert only contract-relevant fields.

Preferred style:

```js
describe("POST /api/v1/auth/login", () => {
  it("returns 200 and a token cookie for valid credentials", async () => {
    // Arrange
    const user = await createStudentUser();

    // Act
    const response = await request(app).post("/api/v1/auth/login").send({
      email: user.email,
      password: "Password123",
    });

    // Assert
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });
});
```

## AI Agent Instructions

Read only the files needed for the target endpoint.

- Do not scan the whole project.
- Start from the route file for the endpoint under test.
- Read only the matching controller, service, schema, middleware, and minimal model/repository context.
- Reuse existing helpers, factories, and auth utilities if they exist.
- Generate only test cases relevant to the endpoint contract.
- Follow existing success and error response shapes exactly.
- Follow current auth behavior exactly: JWT cookie named `token`.
- Do not modify production code unless test generation is blocked by a real issue.
- Do not rewrite route behavior to make tests easier.
- Prefer targeted context retrieval with `rg` and direct file reads.
- Keep test files small and module-focused.

## Minimum Files To Read Before Writing Tests

For a single endpoint, read only:

1. The route file
2. The controller file
3. The service file
4. The validation schema for that module
5. Any middleware used by that route
6. `src/utils/responseHandler.js`
7. `src/middlewares/errorHandler.js`

Read only if needed:

1. Relevant constants file such as roles or statuses
2. Relevant model transformer if response shaping is unclear
3. Relevant repository methods if business rules depend on lookup behavior
4. Relevant Prisma model section only, not the entire schema

Usually avoid reading unrelated modules.

## Expected Test Types

For most endpoints, generate only the relevant subset of these:

- success case
- validation failure
- unauthenticated access (`401`)
- forbidden role or ownership (`403`)
- not found (`404`)
- duplicate resource conflict (`409`)
- invalid state transition
- edge case based on schema or business rule

Examples already supported by current code patterns:

- duplicate email registration
- invalid login credentials
- student hitting admin-only routes
- super admin restrictions around role changes
- duplicate enrollments
- certificate already issued or already revoked

## What Not To Test

Do not test:

- internal controller or service implementation details
- Prisma internals
- Express framework behavior already guaranteed by Express
- exact hashing implementation details
- JWT library internals
- logger internals
- private helper implementation unless it directly changes API contract

Also avoid:

- brittle assertions on every response field when only a few fields are contract-critical
- unnecessary mocks for repository or service layers in API tests

## Maintainability Guidelines

- Use reusable helper functions for login, auth agent creation, and seed setup.
- Use test data factories for users, bootcamps, enrollments, and projects.
- Keep test data deterministic.
- Avoid duplicated setup logic across files.
- Reset database state consistently between tests or suites.
- Prefer explicit fixture creation over hidden global state.
- Keep assertions readable and minimal.

## Future Scalability

Design new tests so the suite can scale cleanly:

- support a dedicated test database
- isolate database cleanup per suite or per test
- mock external services at the boundary only
- stay compatible with CI/CD execution
- avoid shared mutable state so parallel execution remains safe
- keep auth/data factories reusable across modules

## Practical Starting Checklist

Before generating tests for an endpoint:

1. Read the route file.
2. Read the matching controller and service.
3. Read the module schema and route middleware.
4. Confirm expected success and error response shapes.
5. Create only the smallest useful set of scenarios.
6. Import `app` from `src/app.js`.
7. Use Supertest with cookie-aware auth flow where needed.

## Current Repo Notes

- The project already uses ES modules.
- Auth is cookie-based, not bearer-token-first.
- Role checks rely on `authenticate` followed by `requireRole(...)`.
- Shared error shape comes from `src/middlewares/errorHandler.js`.
- Shared success shape comes from `src/utils/responseHandler.js`.
- If test tooling is not yet installed in `package.json`, add Vitest and Supertest in the test setup task, not by changing production behavior.
