# Shared Foundations — SQL

Database support notes for the **shared infrastructure layer** of the Foundry LMS backend.

This module does **not** define its own business tables.  
Instead, it defines shared database-access expectations and boundaries that other modules rely on.

## What This Module Needs

| Table / DB Object        | Purpose                                                                                                  |
| ------------------------ | -------------------------------------------------------------------------------------------------------- |
| **PostgreSQL database**  | Main platform database used by the backend.                                                              |
| **Prisma client access** | Shared database-access mechanism used by repositories across all feature modules.                        |
| **Feature-owned tables** | Actual tables used by the system, owned by modules such as auth, bootcamps, enrollments, and audit logs. |

## Tables / Schema Objects This Module Owns

This module does **not** create or own any business tables in the current MVP.

It does not define:

- user tables
- bootcamp tables
- enrollment tables
- audit log tables

Those belong to feature modules.

## What This Module Is Responsible For

Although it does not own schema objects directly, this module is responsible for shared database-access support, including:

- centralized Prisma client usage
- common DB access conventions
- shared patterns for error-safe DB interaction
- consistent repository-to-database expectations

## Dependencies

This module does not depend on a specific feature table.

However, it supports all feature modules that use database access, including:

- **02-auth**
- **03-users**
- **04-bootcamps**
- **05-enrollments**
- **06-audit-logs**

## Important Rules

- this module must not introduce feature-specific tables
- this module must not contain business-specific DB logic
- database access should be centralized through shared infrastructure such as Prisma client setup
- table ownership must remain inside the correct feature module
- repository classes/functions in feature modules should use shared DB access utilities from this module

## Prisma / DB Access Expectation

This module should provide or support:

- a centralized Prisma client instance
- a reusable database access pattern
- safe error propagation from repository layer upward

This helps all feature modules avoid duplicated DB bootstrap logic.

## Why This Module Still Has a SQL README

This file exists for consistency and clarity.

Even though this module does not own business tables, it still affects how the backend interacts with the database as a whole.

This file makes it clear that:

- table ownership is intentionally absent here
- DB interaction support is still part of this shared module
- coding agents should not try to invent schema objects inside this module

## Relationship to Other Modules

This module supports the SQL/database behavior of other modules, but does not replace their schema ownership.

Examples:

- **02-auth** owns `users`
- **04-bootcamps** owns `bootcamps`
- **05-enrollments** owns `enrollments`
- **06-audit-logs** owns `audit_logs`

This module only provides the shared access layer and conventions around them.

## Future Extension Notes

Later, this module may support additional shared DB-related infrastructure such as:

- transaction helpers
- pagination helpers
- soft-delete conventions
- common query utilities
- DB health-check helpers
- test database setup helpers

These are infrastructure concerns, not business schema ownership.

## Dependency Order

This module does not need a schema migration order of its own because it does not create tables.

However, it should be available as shared infrastructure before or alongside feature-module implementation.

## Definition of Done

- [ ] This module clearly owns no business tables.
- [ ] Prisma/database access centralization is documented.
- [ ] SQL/schema ownership remains clearly delegated to feature modules.
- [ ] Coding agents can understand that this module supports DB access but does not define schema.
- [ ] Shared DB-access expectations are documented clearly.
