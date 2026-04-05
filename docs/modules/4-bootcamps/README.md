# Module: Bootcamps

## What This Module Does

Provides **bootcamp management functionality** for the Foundry LMS backend.

This module handles:

- creating bootcamps
- updating bootcamp details
- publishing/unpublishing bootcamps
- retrieving bootcamps for public users
- retrieving bootcamps for admin management

This module answers:

👉 “What bootcamps exist on the platform?”  
👉 “Who can create and manage bootcamps?”

---

## Scope (What Belongs in This Module)

- Create new bootcamp (admin)
- Update bootcamp details (admin)
- Publish / unpublish bootcamp
- Get all bootcamps (public + admin view)
- Get single bootcamp by slug or ID
- Admin bootcamp listing (full data)
- Public bootcamp listing (filtered)

### Important boundary

This module focuses on **bootcamp entity management only**.

This module does **not** handle:

- enrollments (who joined)
- user access control to content
- lesson/content structure
- payments

Those belong to other modules.

---

## What We Build

### 1. Routes (e.g. `src/routes/v1/bootcamps/bootcamps.routes.js`)

Public routes:

- `GET /v1/bootcamps` – Get published bootcamps
- `GET /v1/bootcamps/:slug` – Get single bootcamp (public)

Admin routes:

- `GET /v1/bootcamps/admin` – Admin bootcamp list
- `POST /v1/bootcamps` – Create bootcamp
- `PATCH /v1/bootcamps/:id` – Update bootcamp
- `DELETE /v1/bootcamps/:id` – Delete bootcamp
- `PATCH /v1/bootcamps/:id/publish` – Publish bootcamp
- `PATCH /v1/bootcamps/:id/unpublish` – Unpublish bootcamp

> **Important:** `GET /v1/bootcamps/admin` must be registered **before** `GET /v1/bootcamps/:slug`. If registered after, Express will match `admin` as a slug value and the admin list route will never be reached.

---

### 2. Controllers (`src/controllers/v1/bootcamps/bootcamps.controller.js`)

- Read request input
- Call bootcamp service
- Return structured responses
- Handle slug vs ID access patterns
- Handle delete request and return appropriate success response

---

### 3. Services (`src/services/v1/bootcamps/bootcamps.service.js`)

- Create bootcamp → trigger audit log on success
- Update bootcamp details → trigger audit log on success
- Delete bootcamp → validate existence → trigger audit log on success
- Publish bootcamp → trigger audit log on success
- Unpublish bootcamp → trigger audit log on success
- Fetch all bootcamps (public)
- Fetch all bootcamps (admin)
- Fetch bootcamp by slug
- Validate business rules

> **Audit rule:** All state-changing operations (create, update, delete, publish, unpublish) must trigger an audit log entry from inside this service layer, not from the controller.

---

### 4. Repositories (`src/repositories/v1/bootcamps/bootcamps.repository.js`)

- Create bootcamp
- Update bootcamp
- Delete bootcamp by ID
- Find by ID
- Find by slug
- List bootcamps
- Handle filtering (published vs all)

---

### 5. Models & Constants

- **Models**
  - Public bootcamp response shape
  - Admin bootcamp response shape

- **Constants**
  - bootcamp status values
  - default visibility rules
  - validation messages

---

### 6. Middleware Usage

- Public routes → no auth required
- Admin routes → require:
  - `ADMIN`
  - `SUPER_ADMIN`

---

## Data / Tables

This module introduces the **bootcamps table**.

Expected fields:

- `id`
- `title`
- `slug`
- `description`
- `price`
- `isPublished`
- `createdAt`
- `updatedAt`

---

## Layer Order (Coding Agent Guide)

1. Route → controller only
2. Controller → service only
3. Service → repository only
4. Repository → Prisma/database only

### Important rules

- no DB logic in controller
- no request parsing in service
- no business logic in route

---

## Dependencies

- `src/middlewares/authenticate.js`
- `src/middlewares/requireRole.js`
- `src/utils/Errors.js`
- `src/utils/responseHandler.js`
- `src/utils/prisma.js`

---

## Important Business Rules

### Bootcamp creation

- only `ADMIN` or `SUPER_ADMIN` can create bootcamps
- slug must be unique
- title is required
- default state: `isPublished = false`

---

### Bootcamp visibility

- public users can only see:
  - published bootcamps

- admins can see:
  - all bootcamps (published + unpublished)

---

### Bootcamp updates

- only admins can update
- slug should not change frequently (optional rule)
- updates must validate required fields

---

### Bootcamp deletion

- only `ADMIN` or `SUPER_ADMIN` can delete bootcamps
- bootcamp must exist before deletion
- deletion must be audited

---

### Publish / Unpublish

- publish makes bootcamp visible to public
- unpublish hides it
- only admins can perform these actions

---

## Expected Response Behavior

Success:

- bootcamp created
- bootcamp updated
- bootcamp published/unpublished
- bootcamps fetched

Errors:

- bootcamp not found
- duplicate slug
- unauthorized access
- invalid input

---

## Security Expectations

- admin routes must be protected
- slug must not expose sensitive data
- validation must prevent invalid input
- no internal DB structure leaks

---

## How This Fits With Other Modules

- **02-auth** → protects admin routes
- **03-users** → admin users manage bootcamps
- **05-enrollments** → links users to bootcamps
- **06-audit-logs** → tracks bootcamp changes

This module defines the **core product offering**.

---

## Definition of Done

- [ ] Bootcamps can be created by admins
- [ ] Bootcamps can be updated
- [ ] Bootcamps can be deleted by admins
- [ ] Bootcamps can be published/unpublished
- [ ] Public users can see only published bootcamps
- [ ] Admins can see all bootcamps
- [ ] Slug is unique
- [ ] Audit log is triggered for create, update, delete, publish, and unpublish
- [ ] All routes follow layer architecture
- [ ] Module is ready for enrollments to depend on
