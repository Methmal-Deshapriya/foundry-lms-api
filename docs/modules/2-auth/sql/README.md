# Auth — SQL

Database support for **platform authentication and system-level role identity**: who can log in, what role they have, and the minimum user data required for authentication and authorization.

## What This Module Needs

| Table / DB Object | Purpose                                                                               |
| ----------------- | ------------------------------------------------------------------------------------- |
| **Role enum**     | Defines system roles used by the application: `STUDENT`, `ADMIN`, `SUPER_ADMIN`.      |
| **users**         | Stores registered platform users, their credentials, profile basics, and system role. |

## Tables / Schema Objects This Module Owns

- **Role enum** — Owned here as part of the application schema definition.
- **users** — Owned here. Must exist before modules that depend on authenticated users and role-aware actions.

This module is the first core business schema module because other modules depend on users existing.

## Dependencies

- No dependency on other Foundry LMS business modules.
- This module should be applied before:
  - bootcamps
  - enrollments
  - audit logs

## Key Columns

### `users`

Important columns expected in this module include:

- `id` — primary key
- `name` — user display/full name
- `email` — unique login identity
- `password` — hashed password only
- `role` — enum value: `STUDENT`, `ADMIN`, or `SUPER_ADMIN`
- `createdAt`
- `updatedAt`

### Role enum

Role values expected:

- `STUDENT`
- `ADMIN`
- `SUPER_ADMIN`

## Important Rules

- `email` must be unique.
- `password` must store only a secure hash, never plain text.
- new self-registered users must default to `STUDENT`.
- `role` controls **system authority**, not bootcamp access.
- bootcamp access must be handled later through the **enrollments** module, not through extra auth roles.

## Why This Module Comes First

Other modules depend on authenticated platform users.

Examples:

- **bootcamps** may record who created or updated data later if needed
- **enrollments** needs `userId`
- **audit logs** may need `actorUserId`

Because of that, the auth/user schema must be in place before those modules are introduced.

## Seed / Initial Data

This project does **not** need a separate `roles` table for the current MVP if Prisma enum-based roles are used.

Instead, the role values are defined in the schema as an enum.

### Initial super admin note

Although the role enum itself does not need seeding like a table, the system will usually need at least one initial `SUPER_ADMIN` user.

That initial user can be created by one of these controlled approaches later:

- manual DB seed script
- Prisma seed
- one-time setup script
- direct admin bootstrap process

This should be done carefully because `SUPER_ADMIN` is the highest-authority role in the system.

## Expected Ownership By This Module

This module owns:

- platform user identity
- login-related user data
- role identity for system-level authorization

This module does **not** own:

- bootcamp access rules
- enrollments
- bootcamp content permissions
- audit event history

## Constraint Expectations

Expected constraints include:

- unique constraint on `email`
- enum constraint on `role`
- primary key on `id`

Additional indexes may later be considered for:

- `email`
- `role`

## Dependency Order

When planning schema creation and migrations, apply in this order:

1. **02-auth**
   - role enum
   - users

2. **04-bootcamps**
   - bootcamps

3. **05-enrollments**
   - enrollments
   - depends on users and bootcamps

4. **06-audit-logs**
   - audit logs
   - may reference users through actor fields

## Definition of Done

- [ ] Role enum is defined with `STUDENT`, `ADMIN`, and `SUPER_ADMIN`.
- [ ] `users` table is defined with authentication-related fields.
- [ ] `email` is unique.
- [ ] password storage is designed for hashed values only.
- [ ] new users default to `STUDENT`.
- [ ] auth schema is ready for other modules to depend on.
- [ ] initial `SUPER_ADMIN` creation strategy is identified.
