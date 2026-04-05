# Module: Audit Logs

## What This Module Does

Provides **audit logging for important system actions** in the Foundry LMS backend.

This module handles:

- recording important actions performed inside the system
- tracking who performed an action
- tracking what entity was affected
- storing useful context for review and debugging
- supporting accountability for sensitive operations

This module answers:

👉 “Who did what in the system?”  
👉 “What important action happened?”  
👉 “When did it happen?”  
👉 “What object was affected?”

---

## Scope (What Belongs in This Module)

- Record audit events for important business actions
- Define the audit event structure
- Store actor, action, entity, and context
- Support future admin/super-admin audit log viewing
- Provide reusable audit logging support for other modules

### Important boundary

This module focuses on **recording and storing important system activity**.

This module does **not** handle:

- general app debug logging
- infrastructure/server logs
- analytics reporting
- monitoring dashboards
- business logic of other modules

Other modules decide **when** an action is important.  
This module provides the structure to **record** it consistently.

---

## What We Build

### 1. Routes (e.g. `src/routes/v1/audit-logs/auditLogs.routes.js`)

For the MVP, write operations are not exposed directly as public routes.

The main route planned later is:

- `GET /v1/audit-logs` – View audit logs (likely `SUPER_ADMIN` only)

Possible future routes:

- `GET /v1/audit-logs/:id` – View a single audit event
- `GET /v1/audit-logs?actorUserId=...&action=...` – Filter audit events

### 2. Controllers (`src/controllers/v1/audit-logs/auditLogs.controller.js`)

For MVP:

- return audit logs for authorized internal/system users if read APIs are implemented
- read filters from query params
- return structured responses

### 3. Services (`src/services/v1/audit-logs/auditLogs.service.js`)

- Create audit event records
- Validate audit payload shape
- Provide reusable method for other services, such as:
  - `createAuditLog(...)`
- Fetch audit logs for review (future)
- Filter audit logs by actor, action, entity, or date (future)

### 4. Repositories (`src/repositories/v1/audit-logs/auditLogs.repository.js`)

- Create audit log entry
- Fetch audit log list
- Fetch audit log by ID
- Support filtering queries later

### 5. Models & Constants

- **Models**
  - Audit event response shape
  - Safe audit log list item shape

- **Constants**
  - action names
  - entity types
  - audit-related messages

### 6. Middleware Usage

- Audit log creation should happen from service layer, not from direct external route calls
- Audit log reading routes, when added, should require:
  - authentication
  - strong role protection
  - likely `SUPER_ADMIN` only for version 1

---

## Data / Tables

This module introduces the **audit_logs** table.

Expected fields:

- `id`
- `actorUserId`
- `action`
- `entityType`
- `entityId`
- `description`
- `metadata`
- `createdAt`

### Notes

- `actorUserId` identifies who performed the action
- `entityType` identifies what kind of object was affected
- `entityId` identifies the affected record
- `metadata` stores additional structured context when useful

---

## Layer Order (Coding Agent Guide)

1. Route → controller only
2. Controller → service only
3. Service → repository only
4. Repository → Prisma/database only

### Important rules

- audit logs must not be created directly inside controllers
- business modules should call audit logging from services
- audit log writing is a cross-cutting concern, but still must follow the layer structure

---

## Dependencies

- **02-auth**
  - provides acting user identity for `actorUserId`

- **03-users**
  - role and user-management actions may produce audit events

- **04-bootcamps**
  - bootcamp create/update/publish actions should produce audit events

- **05-enrollments**
  - enrollment actions should produce audit events

- `src/utils/Errors.js`
- `src/utils/responseHandler.js`
- `src/utils/prisma.js`

---

## Important Business Rules

### What should be audited first

The first priority audit actions in version 1 are:

- user role changes
- admin promotions and demotions
- bootcamp creation
- bootcamp updates
- bootcamp publish/unpublish
- admin-created enrollments

### Audit design rule

Audit logging should happen **inside service logic** when an important business action succeeds.

That means:

- controllers do not decide audit policy
- repositories do not decide audit policy
- services decide when an action is important enough to be recorded

### Important v1 alignment

Because version 1 uses **manual admin enrollment after external payment confirmation**, enrollment actions performed by admins are especially important and should be auditable.

---

## Expected Response Behavior

If read APIs are added:

Success:

- audit logs retrieved
- audit log detail retrieved

Errors:

- unauthorized access
- forbidden access
- invalid filter/query input
- audit record not found

For write behavior:

- audit log creation is usually internal and should not require a direct public response route in MVP

---

## Security Expectations

- audit logs must not be publicly accessible
- audit log viewing should be tightly restricted
- audit records should not be casually editable or deletable
- audit writing should be automatic and consistent for important actions
- metadata should avoid storing sensitive secrets
- password hashes, tokens, and secrets must never be written into audit metadata

---

## How This Fits With Other Modules

- **02-auth**
  → provides authenticated actor identity

- **03-users**
  → role-change events should be audited

- **04-bootcamps**
  → bootcamp management actions should be audited

- **05-enrollments**
  → admin enrollment actions should be audited

This module supports accountability across the whole backend.

---

## Definition of Done

- [ ] Audit log structure is clearly defined.
- [ ] A reusable service-level audit logging pattern exists.
- [ ] Important actions from users, bootcamps, and enrollments can be recorded.
- [ ] Audit creation happens from services, not controllers.
- [ ] Sensitive secrets are excluded from audit metadata.
- [ ] Read access strategy for audit logs is documented.
- [ ] Module is ready to support cross-module accountability in version 1.
