# Architecture & Foundation — SQL

This module does **not** define its own business tables.

It defines the **database foundation rules** for the Foundry LMS backend and explains how SQL/schema ownership is distributed across feature modules.

## What This Module Needs

- **Platform DB**: PostgreSQL database used by the main Express.js backend.
- **ORM**: Prisma is the source of schema definition and migration generation.
- **Environment-based DB config**: All database connection strings and secrets must come from env vars.
- **Migration discipline**: Schema changes should be introduced through Prisma migrations in a controlled order.
- **Shared database conventions**: Naming, constraints, foreign keys, unique rules, timestamps, and indexing strategy should stay consistent across modules.

## What This Module Does Not Own

This module does not directly own feature/business tables.

Business tables are owned by feature modules such as:

- **02-auth / 03-users** → user-related tables and role-related structure
- **04-bootcamps** → bootcamp-related tables
- **05-enrollments** → enrollment relationship tables
- **06-audit-logs** → audit log tables

This module only defines the foundation and dependency rules those modules should follow.

## Database Foundation Rules

- PostgreSQL is the system database.
- Prisma schema is the main source of truth for application models.
- Migrations must be created in an order that respects foreign-key dependencies.
- Shared columns such as `id`, `createdAt`, and `updatedAt` should follow consistent conventions.
- Unique constraints must be enforced at database level for important business rules.
- Environment variables must be used for all DB connection settings.
- No secrets should be hardcoded in schema or source files.

## Expected Environment Configuration

The following DB-related config is expected to exist through environment variables:

- PostgreSQL connection string
- optional direct URL if Prisma setup requires it later
- environment-specific DB selection for:
  - local
  - development
  - production
- future test database config if automated testing is added

## Dependency Order

When planning schema creation and applying migrations, use this order so relationships are introduced cleanly:

1. **02-auth / 03-users**
   - role enum
   - users table

2. **04-bootcamps**
   - bootcamps table

3. **05-enrollments**
   - enrollments table
   - depends on users and bootcamps

4. **06-audit-logs**
   - audit logs table
   - may reference actor user depending on final schema design

## Why This Order Matters

- `enrollments` depends on both `users` and `bootcamps`
- `audit_logs` may depend on `users` if actor references are enforced with a foreign key
- applying schema in the correct order avoids broken migration flow and FK issues

## Prisma Responsibility

This project uses Prisma as the schema and migration layer.

That means:

- model definitions should be maintained in `prisma/schema.prisma`
- migrations should be generated through Prisma
- database structure should not drift away from Prisma definitions
- feature modules should document the schema they own before implementation

## SQL Ownership Rule

Each feature module should document:

- the tables it owns
- important columns
- keys and constraints
- relationships
- business-critical unique rules
- notes about cascade behavior or deletion rules if relevant

This Architecture module does not define those tables directly.  
It defines how that ownership should be organized.

## Current Expected Feature Ownership

- **Users/Auth**
  - `User`
  - role enum

- **Bootcamps**
  - `Bootcamp`

- **Enrollments**
  - `Enrollment`

- **Audit Logs**
  - `AuditLog`

## Important Constraint Expectations

Examples of constraints expected in feature modules:

- unique email for users
- unique slug for bootcamps
- unique `(userId, bootcampId)` for enrollments
- careful FK design for audit log actor references if used

These constraints belong to feature schemas, but this module requires that they be enforced at database level, not only in application logic.

## Future Extension Notes

Later modules may introduce additional tables such as:

- lessons
- bootcamp sections
- progress records
- payments
- notifications
- file assets

Those are out of scope for the current MVP and should not be added to the base schema prematurely.

## Definition of Done (SQL Foundation)

- [ ] PostgreSQL is confirmed as the platform database.
- [ ] Prisma is confirmed as the schema/migration authority.
- [ ] DB connection strategy is environment-based.
- [ ] Module schema dependency order is documented.
- [ ] Feature modules are responsible for documenting their own tables.
- [ ] Shared database conventions are clear before schema implementation begins.
