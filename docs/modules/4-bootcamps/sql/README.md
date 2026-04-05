# Bootcamps — SQL

Database support for **bootcamp management**: defining the core product entities offered by the platform.

## What This Module Needs

| Table         | Purpose                                                                                         |
| ------------- | ----------------------------------------------------------------------------------------------- |
| **bootcamps** | Stores all bootcamps created in the system, including metadata, pricing, and publication state. |

## Tables This Module Owns

- **bootcamps** — Created and owned by this module. Other modules (such as enrollments and audit logs) will reference it.

This is the first **core business entity table** in the system.

## Dependencies

- **02-auth**
  - users table (optional reference if creator tracking is added later)

This module does not strictly require foreign keys in MVP, but may optionally include:

- `createdBy` → users.id (future-safe design)

## Key Columns

### `bootcamps`

- `id` — primary key
- `title` — bootcamp name
- `slug` — unique identifier used in URLs
- `description` — detailed content
- `price` — numeric value
- `isPublished` — boolean (controls public visibility)
- `createdAt`
- `updatedAt`

## Important Rules

- `slug` must be unique across all bootcamps
- `title` is required
- `isPublished` defaults to `false`
- unpublished bootcamps must not appear in public queries
- price must be non-negative
- slug should be URL-friendly (validated at application level)

## Why This Table Is Important

- represents the **main product unit** of the LMS
- all enrollments depend on this table
- public-facing content is driven by this table

## Constraint Expectations

- primary key on `id`
- unique constraint on `slug`
- not-null constraints on:
  - `title`
  - `slug`
  - `price`
  - `isPublished`
- optional index on:
  - `isPublished` (for faster public queries)

## Future Extension Notes

This table may later be extended with:

- `thumbnailUrl`
- `category`
- `duration`
- `level` (beginner, intermediate, advanced)
- `instructorId`
- `createdBy` (FK → users)
- soft delete flag (`isDeleted`)

These are not required for MVP and should not be added prematurely.

## Dependency Order

When planning schema creation and migrations, apply in this order:

1. **02-auth**
   - users

2. **04-bootcamps**
   - bootcamps

3. **05-enrollments**
   - enrollments (depends on users + bootcamps)

4. **06-audit-logs**
   - audit logs

## Relationship to Other Modules

- **05-enrollments**
  - uses `bootcampId` to link users to bootcamps

- **06-audit-logs**
  - records bootcamp creation, updates, deletion, publishing, and unpublishing actions

## Data Integrity Expectations

- no duplicate slugs allowed
- no orphan enrollments (enforced via FK later)
- consistent timestamps for auditing and sorting

## Definition of Done

- [ ] `bootcamps` table is defined
- [ ] `slug` is unique
- [ ] required fields are enforced
- [ ] publication state is controlled via `isPublished`
- [ ] schema supports future relationships (enrollments, audit)
- [ ] table is ready for production-level usage
