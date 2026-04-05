# Users — SQL

Database support for **administrative user control** in the Foundry LMS backend.

This module uses the user schema introduced by the **Auth** module and does not create new tables for the current MVP.

## What This Module Needs

| Table / DB Object | Purpose                                                                                                                |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **users**         | Stores platform users, their profile basics, and system role. This module reads and updates user data from this table. |
| **Role enum**     | Defines allowed system roles: `STUDENT`, `ADMIN`, `SUPER_ADMIN`. Used when validating role transitions.                |

## Tables / Schema Objects This Module Owns

This module does **not** create its own tables in the current MVP.

It depends on schema objects owned by the **02-auth** module:

- **Role enum**
- **users**

This module is responsible for the **business use** of that data, not for introducing new schema objects.

## Dependencies

- **02-auth**
  - role enum
  - users table

No dependency on other business tables is required for the core MVP behavior of this module.

## Key Columns

### `users`

Important columns used by this module include:

- `id`
- `name`
- `email`
- `role`
- `createdAt`
- `updatedAt`

## What This Module Uses the Table For

This module uses the `users` table for:

- listing users for admin views
- promoting a user to `ADMIN`
- demoting an `ADMIN` to `STUDENT`

> **Note:** Fetching the current user profile is handled by `GET /v1/auth/me` in the Auth module. Profile updates and single user detail by ID are out of scope for v1.

## Important Rules

- this module must never expose the `password` field in responses
- role changes must respect system rules
- only `SUPER_ADMIN` can promote a user to `ADMIN`
- only `SUPER_ADMIN` can demote an `ADMIN` to `STUDENT`
- this module manages **system role changes**, not bootcamp access
- enrollment-based access remains the responsibility of the **05-enrollments** module

## Why This Module Does Not Own New Tables

For the current MVP, user management actions operate directly on the existing `users` table.

Examples:

- role updates modify `users.role`
- user listing reads from `users`

Because of that, no separate table is required yet.

## Future Extension Notes

Later, this module may introduce additional schema support if needed, such as:

- user profile expansion table
- account status fields
- profile image/file references
- user preferences
- admin notes on users

These are out of scope for the current MVP and should not be added unless needed.

## Constraint Expectations

This module relies on constraints already defined in **02-auth**, including:

- primary key on `id`
- unique constraint on `email`
- enum constraint on `role`

This module also depends on application-level validation for safe role transitions.

## Dependency Order

When planning schema creation and migrations, apply in this order:

1. **02-auth**
   - role enum
   - users

2. **03-users**
   - no new schema objects in MVP
   - uses auth-owned schema

3. **04-bootcamps**
   - bootcamps

4. **05-enrollments**
   - enrollments

5. **06-audit-logs**
   - audit logs

## Relationship to Audit Logging

This module does not own the audit log table, but important actions from this module should later be recorded by **06-audit-logs**, such as:

- promote user to admin
- demote admin to student
- other sensitive user-management actions if added

## Definition of Done

- [ ] This module clearly depends on the auth-owned `users` schema.
- [ ] No new tables are introduced unnecessarily.
- [ ] User listing is supported by the existing schema.
- [ ] Role updates (promote/demote) are supported by the existing schema.
- [ ] Sensitive fields are excluded at application level.
- [ ] SQL/database ownership remains clear between Auth and Users modules.
