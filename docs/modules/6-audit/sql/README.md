# Audit Logs — SQL

Database support for **tracking important system actions** in the Foundry LMS backend.

This module provides a structured way to record and store audit events for accountability, security, and debugging.

---

## What This Module Needs

| Table / DB Object | Purpose                                                                                        |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| **audit_logs**    | Stores records of important actions performed in the system (who did what, when, and on what). |
| **users**         | Referenced by `actorUserId` to identify who performed the action.                              |

---

## Tables / Schema Objects This Module Owns

- **audit_logs** — Created and owned by this module.

This table is responsible for storing system-level audit events.

---

## Dependencies

- **02-auth**
  - users table

This module depends on users because every audit record must identify an actor.

---

## Key Columns

### `audit_logs`

Important columns expected in this module include:

- `id` — primary key
- `actorUserId` — foreign key → users
- `action` — name of the action performed
- `entityType` — type of entity affected (e.g., USER, BOOTCAMP, ENROLLMENT)
- `entityId` — ID of the affected record
- `description` — short human-readable explanation of the action
- `metadata` — optional structured JSON data for additional context
- `createdAt` — timestamp of when the action occurred

---

## Important Rules

- every audit record must represent a **completed action**
- audit logs must be **append-only** (no updates or deletes in normal operation)
- every audit log must have an actor (`actorUserId`)
- audit logs should not store sensitive secrets
- metadata must be optional and used carefully
- audit logs should be created from service layer logic only

---

## Purpose of This Table

This table exists to:

- track important system actions
- provide accountability for admins and super admins
- support debugging and incident investigation
- enable future admin-facing audit dashboards

---

## What Should Be Logged

For version 1, the most important audit events include:

- user role changes
- admin promotions/demotions
- bootcamp creation
- bootcamp updates
- bootcamp publish/unpublish
- admin enrolling students into bootcamps

---

## Constraint Expectations

Expected constraints include:

- primary key on `id`
- foreign key on `actorUserId`

### Foreign Key Rule

- `actorUserId` must reference a valid user

---

## Relationship Expectations

This module creates a one-to-many relationship:

- one user → many audit logs

Each audit record belongs to one actor.

---

## Indexing Expectations

The table should support efficient querying for:

- logs by user
- logs by entity
- logs by action
- logs by time

Indexes should be considered for:

- `actorUserId`
- `entityType`
- `entityId`
- `createdAt`

---

## Data Design Notes

### Why JSON metadata?

The `metadata` column allows flexible storage of:

- before/after values
- contextual data
- additional identifiers

This avoids rigid schema changes for every new audit requirement.

---

### Why no strict enum constraints?

For flexibility:

- `action` and `entityType` may evolve over time
- enforcing enums at DB level is optional and can be added later

---

## Dependency Order

When planning schema creation and migrations, apply in this order:

1. **02-auth**
   - users

2. **04-bootcamps**
   - bootcamps

3. **05-enrollments**
   - enrollments

4. **06-audit-logs**
   - audit_logs

---

## Relationship to Other Modules

This module supports:

- **03-users**
  → logs role changes and admin actions

- **04-bootcamps**
  → logs bootcamp management actions

- **05-enrollments**
  → logs admin enrollment actions

This module does not depend on them structurally, but is triggered by their service logic.

---

## Future Extension Notes

This module can be extended later with:

- filtering optimizations
- partitioning for large datasets
- soft archival strategies
- audit severity levels
- event categorization
- IP address / device info
- request tracing IDs

---

## Definition of Done

- [ ] `audit_logs` table is defined.
- [ ] `actorUserId` references `users`.
- [ ] audit logs are append-only.
- [ ] structure supports action, entity, and metadata tracking.
- [ ] indexing strategy is considered.
- [ ] schema supports future extensibility without redesign.
- [ ] aligns with service-layer audit logging approach.
