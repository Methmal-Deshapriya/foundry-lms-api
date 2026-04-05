# Module: Shared Foundations

## What This Module Does

Provides the **core infrastructure layer** for the Foundry LMS backend.

This module contains shared utilities and system-level components used across all feature modules.

It is responsible for:

- standardizing error handling
- standardizing API responses
- handling authentication and authorization middleware
- providing reusable helper utilities
- ensuring consistency across the entire backend

---

## Module Nature (IMPORTANT)

This is **not a feature module**.

This module:

- does NOT represent business functionality
- does NOT have routes/controllers/services structure
- is used by all other modules
- acts as the foundation layer of the system

---

## What This Module Contains

### 1. Errors

Provides a standardized error system.

Responsibilities:

- define reusable error classes
- define consistent error structure
- allow predictable error handling across the system

Examples:

- `NotFoundError`
- `UnauthorizedError`
- `ForbiddenError`
- `ValidationError`

---

### 2. Responses

Provides a consistent API response format.

Responsibilities:

- standardize success responses
- standardize error responses
- ensure predictable frontend integration

Example structure:

```json
{
  "success": true,
  "data": {},
  "message": "Operation successful"
}
```

---

### 3. Middleware

Provides reusable middleware for request handling.

Responsibilities:

- authentication (JWT validation)
- role-based authorization
- request validation (future)
- global error handling

Examples:

- `authenticate`
- `requireRole`
- `errorHandler`

---

### 4. Helpers / Utilities

Provides shared utility functions.

Responsibilities:

- Prisma client instance
- JWT helper functions
- configuration handling
- reusable utility functions

Examples:

- `prisma.js`
- `jwt.js`
- `env.js`
- `constants.js`

---

## How Other Modules Use This

All feature modules depend on this module.

Usage examples:

- Controllers use response helpers
- Services throw standardized errors
- Routes use authentication middleware
- Services use Prisma helper
- Auth module uses JWT helper

---

## Important Rules

### 1. No Business Logic

This module must **NEVER** contain:

- business rules
- feature-specific logic
- module-specific conditions

### 2. Reusability First

Everything here must be:

- reusable across modules
- generic
- not tightly coupled to one feature

### 3. Single Source of Truth

- All errors must come from this module
- All responses must use the same format
- All middleware must be centralized

### 4. No Circular Dependencies

Feature modules can depend on this module.
This module must **NOT** depend on feature modules.

---

## Folder Structure Expectation

```
src/
  utils/
    prisma.js
    jwt.js
    responseHandler.js
    Errors.js
    constants.js

  middlewares/
    authenticate.js
    requireRole.js
    errorHandler.js
```

---

## Why This Module Is Critical

This module ensures:

- consistency across the entire backend
- cleaner code in feature modules
- easier debugging
- better scalability
- predictable API behavior

Without this module:

- every module would implement its own patterns
- inconsistency would grow quickly
- maintenance would become difficult

---

## Future Extensions

This module can be expanded with:

- request validation helpers (e.g., Zod/Joi)
- logging utilities
- rate limiting middleware
- caching helpers
- environment-based config management

---

## Definition of Done

- [ ] error system is standardized
- [ ] response format is consistent across APIs
- [ ] authentication middleware exists
- [ ] role-based authorization middleware exists
- [ ] Prisma client is centralized
- [ ] JWT handling is centralized
- [ ] no business logic exists in this module
- [ ] all feature modules depend on this module correctly
