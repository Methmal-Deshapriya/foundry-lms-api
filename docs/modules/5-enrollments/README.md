# Module: Enrollments

## What This Module Does

Provides **bootcamp access control** for the Foundry LMS backend.

This module handles:

- enrolling users into bootcamps
- checking whether a user has access to a bootcamp
- retrieving a user's enrolled bootcamps
- enforcing access rules for protected bootcamp access

This module answers:

👉 “Which bootcamps does a user have access to?”  
👉 “Can this user access this bootcamp?”  
👉 “How is bootcamp access granted in version 1?”

---

## Scope (What Belongs in This Module)

- Admin enrolls a student into a bootcamp
- Get all enrollments for a student
- Check access (user → bootcamp)
- Prevent duplicate enrollments
- Get students enrolled in a bootcamp
- Treat enrollment as the official access-granting action inside the system

### Important boundary

This module focuses on **access relationships between users and bootcamps**.

This module does **not** handle:

- authentication (who the user is)
- bootcamp creation or updates
- lesson/content delivery
- payment processing
- receipt upload or payment gateway handling

---

## Version 1 Business Process (VERY IMPORTANT)

In version 1, **payments happen outside the system**.

The expected business flow is:

1. A student registers and gets a normal `STUDENT` account.
2. The student makes the payment outside the platform.
3. The student sends the payment receipt to an admin.
4. The admin reviews the receipt through their normal workflow (for example, email).
5. The admin logs into Foundry LMS.
6. The admin manually enrolls the student into the correct bootcamp.
7. Once the enrollment exists, the student gets access to that bootcamp.

### Important rule

For version 1:

- the backend does **not** verify payments directly
- the backend does **not** process payment receipts
- the backend trusts the admin’s manual confirmation step
- **enrollment is the system action that grants access**

This is a core v1 business rule and must remain clear in implementation.

---

## What We Build

### 1. Routes (e.g. `src/routes/v1/enrollments/enrollments.routes.js`)

Student routes:

- `GET /v1/enrollments/my` – Get current student's enrolled bootcamps

Admin routes:

- `POST /v1/enrollments` – Enroll a student into a bootcamp manually
- `GET /v1/enrollments/bootcamp/:bootcampId/students` – Get students enrolled in a bootcamp

### 2. Controllers (`src/controllers/v1/enrollments/enrollments.controller.js`)

- Read request data (`userId`, `bootcampId`)
- Use `req.user` for acting admin or current student
- Call enrollment service
- Return structured response

### 3. Services (`src/services/v1/enrollments/enrollments.service.js`)

- Enroll student into bootcamp
- Check if enrollment already exists
- Validate bootcamp existence
- Validate user existence
- Get current student's enrollments
- Get enrolled students inside a bootcamp
- Provide helper method:
  - `checkAccess(userId, bootcampId)`

### 4. Repositories (`src/repositories/v1/enrollments/enrollments.repository.js`)

- Create enrollment
- Find enrollment by user + bootcamp
- Get enrollments for a user
- Get students for a bootcamp
- Query relationships efficiently

### 5. Models & Constants

- **Models**
  - Enrollment response shape
  - Student-bootcamp access mapping
  - Bootcamp list shape for enrolled student view

- **Constants**
  - enrollment messages
  - error messages
  - enrollment-related business messages

---

## Middleware Usage

- All routes require authentication (`authenticate`)

Role-based:

- `GET /v1/enrollments/my` → authenticated student/admin/super admin if needed
- `POST /v1/enrollments` → `ADMIN` or `SUPER_ADMIN`
- `GET /v1/enrollments/bootcamp/:bootcampId/students` → `ADMIN` or `SUPER_ADMIN`

---

## Data / Tables

This module introduces the **enrollments table**.

This is a **relationship table** between:

- users
- bootcamps

Expected fields:

- `id`
- `userId`
- `bootcampId`
- `createdAt`

---

## Layer Order (Coding Agent Guide)

1. Route → controller only
2. Controller → service only
3. Service → repository only
4. Repository → Prisma/database only

---

## Dependencies

- **02-auth**
  - provides authenticated user (`req.user`)

- **03-users**
  - user existence and role context

- **04-bootcamps**
  - bootcamp existence

- `src/utils/Errors.js`
- `src/utils/responseHandler.js`
- `src/utils/prisma.js`

- **06-audit-logs**
  - enrollment actions should be auditable

---

## Important Business Rules

### Enrollment rules

- a student can be enrolled in a bootcamp only once
- duplicate enrollments must be prevented
- bootcamp must exist before enrolling
- student must exist before enrolling
- only admins can grant enrollment in version 1
- enrollment is the action that grants bootcamp access

### Access control rule (VERY IMPORTANT)

Access to a bootcamp is granted **only if an enrollment exists**

```txt
if enrollment exists
    → allow access
else
    → deny access
```

### Audit rule

- admin enrollment action must trigger an audit log entry from inside the service layer
- audit log must record actor (admin), action, and the enrolled student + bootcamp

---

## Expected Response Behavior

Use consistent response format for all enrollment routes.

Success responses:

- enrollment created (201)
- enrolled bootcamps list returned (200)
- bootcamp students list returned (200)

Error responses:

- user not found (404)
- bootcamp not found (404)
- already enrolled — duplicate conflict (409)
- unauthorized — not logged in (401)
- forbidden — not an admin (403)

Sensitive internal details must not be exposed in error responses.

---

## Security Expectations

- all enrollment routes require authentication
- only `ADMIN` or `SUPER_ADMIN` can create enrollments
- students cannot enroll themselves — this is intentional v1 design
- a student can only view their own enrolled bootcamps via `/my`
- duplicate enrollment must be prevented at both application and database level
- enrollment is the only mechanism that grants bootcamp access in v1 — do not bypass it

---

## How This Fits With Other Modules

- **02-auth**
  → provides authenticated user identity via `req.user`

- **03-users**
  → user existence must be validated before enrolling

- **04-bootcamps**
  → bootcamp existence must be validated before enrolling

- **06-audit-logs**
  → admin enrollment actions must be recorded as audit events

This module is the final step of the v1 offline payment workflow.

---

## Definition of Done

- [ ] Admin can enroll a student into a bootcamp
- [ ] Duplicate enrollment is prevented (application + DB constraint)
- [ ] Student can view their own enrolled bootcamps (`/my`)
- [ ] Admin can view students enrolled in a bootcamp
- [ ] Audit log is triggered when an admin creates an enrollment
- [ ] Bootcamp and user existence is validated before enrollment
- [ ] Only admins can create enrollments (students cannot self-enroll)
- [ ] Responses are consistent and use shared response format
- [ ] Module correctly reflects the v1 manual enrollment business process
