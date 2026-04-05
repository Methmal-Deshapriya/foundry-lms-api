# Module: Auth

## What This Module Does

Provides **authentication and authorization foundations** for the Foundry LMS backend.

This module handles:

- user registration
- login
- logout
- current authenticated user (`me`)
- JWT issuance and validation
- HTTP-only cookie-based auth flow
- attaching the authenticated user to `req.user`
- role-aware access foundation for other modules

This module is responsible for **who the user is** and **what system role they have**.

It does **not** decide which bootcamps a user can access.  
That is handled by the **Enrollment** module.

---

## Scope (What Belongs in This Module)

- User registration for new platform users
- User login using email and password
- JWT generation and validation
- Auth token transport using HTTP-only cookies
- Logout by clearing auth cookie
- Current authenticated user endpoint
- Middleware that verifies auth and sets `req.user`
- Role-check middleware foundation (`requireRole`)
- Role-aware auth support for:
  - `STUDENT`
  - `ADMIN`
  - `SUPER_ADMIN`

### Important boundary

This module focuses on **platform authentication and system-level role identity**.

This module does **not** handle:

- bootcamp access decisions
- enrollments
- bootcamp content permissions
- bootcamp-specific ownership logic

Those belong to other modules.

---

## What We Build

### 1. Routes (e.g. `src/routes/v1/auth/auth.routes.js`)

- `POST /v1/auth/register` – Register a new user account
- `POST /v1/auth/login` – Log in user and issue auth cookie
- `POST /v1/auth/logout` – Log out user by clearing auth cookie
- `GET /v1/auth/me` – Return current authenticated user

### 2. Controllers (`src/controllers/v1/auth/auth.controller.js`)

- Read `req.body` for register/login input
- Call auth service methods
- Return consistent API responses using response helper
- For `me`, return authenticated user from service or `req.user`-aware flow
- For `logout`, clear cookie and return success response

### 3. Services (`src/services/v1/auth/auth.service.js`)

- Validate registration input and business rules
- Validate login credentials
- Check whether user exists
- Check password hash using bcrypt helper
- Create JWT payload with user identity and role
- Return safe user data for response shaping
- Define how auth cookie should be used in the flow
- Support current-user retrieval
- Trigger audit logging for important auth actions if included in final auth policy

### 4. Repositories (`src/repositories/v1/auth/auth.repository.js` or shared user repository if chosen)

- Find user by email
- Find user by id
- Create new user
- Return only the DB data needed by the service
- Keep queries focused and predictable

### 5. Models & Constants

- **Models**:
  - Map user DB records into safe auth response shapes
  - Remove sensitive fields like password before returning data

- **Constants**:
  - role values
  - cookie name
  - token expiry configuration
  - auth-related messages
  - auth error codes if needed

### 6. Middleware (`src/middlewares/authenticate.js`, `src/middlewares/requireRole.js`)

- Verify JWT from HTTP-only cookie
- Decode and validate token
- Load current user identity into `req.user`
- Reject unauthorized access with 401
- Reject access if token is invalid or missing
- Support role-based route protection for:
  - `ADMIN`
  - `SUPER_ADMIN`
- Allow other modules to reuse this middleware

---

## Data / Tables

This module depends primarily on the **User** table and the **Role enum**.

Expected user-related data includes:

- `id`
- `name`
- `email`
- `password`
- `role`
- `createdAt`
- `updatedAt`

### Role enum

The role enum for this project is:

- `STUDENT`
- `ADMIN`
- `SUPER_ADMIN`

### Important auth rule

- newly registered users should default to `STUDENT`
- auth identifies the user and their system role
- auth does not grant bootcamp access by itself

---

## Layer Order (Coding Agent Guide)

1. Route → controller only
2. Controller → service only
3. Service → repository and shared utils
4. Repository → Prisma/database only

### Important rule

- no DB queries in controller
- no request/response logic inside service
- no business logic inside route
- no password hashing or JWT signing directly inside controller

---

## Dependencies

- `src/utils/Errors.js`
  - for auth-related errors such as validation failure, unauthorized access, conflict errors

- `src/utils/responseHandler.js`
  - for consistent API responses

- `src/utils/jwt.js`
  - for JWT signing and verification

- `src/utils/prisma.js`
  - for Prisma client access if stored under `utils`

- `bcryptjs`
  - for password hashing and password comparison

- `src/middlewares/authenticate.js`
  - for protected route access

- `src/middlewares/requireRole.js`
  - for role-protected routes

- shared auth constants
  - token expiry, cookie name, role values

- Audit logging pattern
  - if login/logout/registration are included in audit scope

---

## Important Business Rules

- email must be unique
- password must never be stored in plain text
- password must be hashed before save
- user registration creates a normal `STUDENT` account unless explicitly designed otherwise
- login succeeds only if credentials are valid
- protected routes require a valid JWT
- the auth cookie must be HTTP-only
- `SUPER_ADMIN` and `ADMIN` are system roles, not separate auth mechanisms
- auth does not determine bootcamp access

### Very important separation

- **Auth answers:** “Who is the user?”
- **Role answers:** “What system authority do they have?”
- **Enrollment answers:** “What bootcamps can they access?”

This separation must remain clear in implementation.

---

## Expected Response Behavior

This module should use the shared response format consistently.

Typical success responses:

- register success
- login success
- logout success
- current user success

Typical error responses:

- invalid credentials
- duplicate email
- unauthorized access
- invalid token
- missing token
- validation errors

Sensitive internal details must not be exposed in auth responses.

---

## Security Expectations

This module is security-sensitive and must be implemented carefully.

### Required expectations

- hash passwords with bcryptjs
- never return password hashes in responses
- use JWT securely
- store JWT in HTTP-only cookies
- set cookie options appropriately based on environment
- validate token before trusting it
- do not trust frontend auth state alone
- protect privileged routes with middleware
- keep secrets only in env vars

### Future security extensions to consider later

- refresh token rotation
- brute-force protection / rate limiting
- account lockout
- email verification
- password reset flow

These are not mandatory for the first MVP unless explicitly added later.

---

## How This Fits With Other Modules

- **03-users** depends on this module for authenticated identity and role checks.
- **04-bootcamps** depends on this module to protect admin and super-admin routes.
- **05-enrollments** depends on this module to identify the acting user and protect enrollment operations.
- **06-audit-logs** may receive important auth-related events defined by service-level audit policy.

This module is the main gateway into all protected backend behavior.

---

## Definition of Done

- [ ] User registration works and creates a `STUDENT` account by default.
- [ ] Login works with email and password.
- [ ] Passwords are securely hashed and verified.
- [ ] JWT is issued and validated correctly.
- [ ] Auth token is transported using HTTP-only cookies.
- [ ] Logout clears the auth cookie correctly.
- [ ] Protected routes can read authenticated user data from `req.user`.
- [ ] Role-based route protection is available for other modules.
- [ ] Sensitive user fields are never exposed in API responses.
- [ ] This module is clear enough for other modules to depend on it safely.
