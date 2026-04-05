# Module: Users

## What This Module Does

Provides **user profile management and administrative user control** for the Foundry LMS backend.

This module handles:

- admin-level user management
- promoting/demoting users (SUPER_ADMIN control)
- viewing user lists for admin dashboards

This module answers:

👉 “How do admins manage users?”  
👉 “Who has what system role?”

---

## Scope (What Belongs in This Module)

- Admin: list all users
- Super Admin: promote user to `ADMIN`
- Super Admin: demote `ADMIN` back to `STUDENT`

> **Out of scope for v1:** User profile update and single user detail by ID are not in the plan. Profile data for the current user is served by `GET /v1/auth/me` in the Auth module.

### Important boundary

This module focuses on **user data and management**, not authentication.

This module does **not** handle:

- login / logout
- password validation
- JWT handling
- cookie handling

Those belong to the **Auth module**.

---

## What We Build

### 1. Routes (e.g. `src/routes/v1/users/users.routes.js`)

Admin routes:

- `GET /v1/users` – Get all users (`ADMIN` or `SUPER_ADMIN`)

Super Admin routes:

- `PATCH /v1/users/:id/promote` – Promote user to ADMIN
- `PATCH /v1/users/:id/demote` – Demote user to STUDENT

> **Note:** Current user profile is served by `GET /v1/auth/me` in the Auth module. Profile update is out of scope for v1.

### 2. Controllers (`src/controllers/v1/users/users.controller.js`)

- Read request params
- Call user service
- Return structured responses

### 3. Services (`src/services/v1/users/users.service.js`)

- Fetch all users (admin view)
- Promote user role (only allowed for SUPER_ADMIN) → trigger audit log on success
- Demote user role (only allowed for SUPER_ADMIN) → trigger audit log on success
- Validate role transitions (prevent invalid operations)
- Ensure business rules are respected

> **Audit rule:** Promote and demote operations must trigger an audit log entry from inside this service layer immediately after a successful role change.

### 4. Repositories (`src/repositories/v1/users/users.repository.js`)

- Find user by ID
- Get all users (with pagination later if needed)
- Update user role
- Keep DB queries simple and reusable

### 5. Models & Constants

- **Models**
  - Format user response safely (no password exposure)
  - Define admin-facing user shape

- **Constants**
  - role values
  - allowed role transitions
  - user-related messages

### 6. Middleware Usage

- Requires authentication middleware (`authenticate`)
- Uses role middleware (`requireRole`)

Role restrictions:

- `GET /users` → ADMIN or SUPER_ADMIN
- Promote/Demote → ONLY SUPER_ADMIN

---

## Data / Tables

This module depends on the **users table** created in the Auth module.

No new tables are required for MVP.

Expected user fields used:

- `id`
- `name`
- `email`
- `role`
- `createdAt`
- `updatedAt`

---

## Layer Order (Coding Agent Guide)

1. Route → controller only
2. Controller → service only
3. Service → repository only
4. Repository → Prisma/database only

### Important rules

- no DB logic in controllers
- no request parsing in services
- no business logic in routes
- role validation must happen in service layer

---

## Dependencies

- `src/middlewares/authenticate.js`
- `src/middlewares/requireRole.js`
- `src/utils/Errors.js`
- `src/utils/responseHandler.js`
- `src/utils/prisma.js`
- role constants from shared config

---

## Important Business Rules

### Role management rules

- Only `SUPER_ADMIN` can:
  - promote a user to `ADMIN`
  - demote an `ADMIN` to `STUDENT`

- `ADMIN` cannot:
  - promote other users
  - modify roles

- `SUPER_ADMIN` cannot:
  - demote themselves (optional safety rule)

### Data protection

- password must never be returned
- sensitive fields must be excluded from responses

---

## Expected Response Behavior

Use consistent response format for:

- user list
- role updates (promote / demote)

Error cases:

- user not found
- unauthorized access
- forbidden role change
- invalid input

---

## Security Expectations

- all routes must be protected (no public user listing)
- role checks must be strictly enforced
- no direct role manipulation from client without validation
- never expose sensitive user data

---

## How This Fits With Other Modules

- **02-auth** provides authentication and `req.user`
- **04-bootcamps** may use user identity for admin actions
- **05-enrollments** links users to bootcamps
- **06-audit-logs** tracks user-related actions (e.g. role changes)

This module enables **admin-level control over platform users**.

---

## Definition of Done

- [ ] Admin can list all users
- [ ] SUPER_ADMIN can promote users to ADMIN
- [ ] SUPER_ADMIN can demote ADMIN to STUDENT
- [ ] Audit log is triggered on promote and demote
- [ ] Role restrictions are strictly enforced
- [ ] No sensitive data is exposed
- [ ] Module is reusable by other modules safely
