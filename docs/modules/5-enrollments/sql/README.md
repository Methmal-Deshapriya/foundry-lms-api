# Enrollments — SQL

Database support for **bootcamp access control** in the Foundry LMS backend.

This module defines the relationship between users and bootcamps.  
An enrollment record means a student has access to a bootcamp.

## What This Module Needs

| Table / DB Object | Purpose                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **enrollments**   | Stores which student has access to which bootcamp. This is the core access-control relationship for bootcamp membership. |
| **users**         | Referenced by `userId`. A student must exist before being enrolled.                                                      |
| **bootcamps**     | Referenced by `bootcampId`. A bootcamp must exist before a student can be enrolled.                                      |

## Tables / Schema Objects This Module Owns

- **enrollments** — Created and owned by this module.

This module introduces the table that grants bootcamp access inside the system.

## Dependencies

- **02-auth**
  - users table

- **04-bootcamps**
  - bootcamps table

This module depends on both existing first, because `enrollments` links users to bootcamps.

## Key Columns

### `enrollments`

Important columns expected in this module include:

- `id` — primary key
- `userId` — foreign key → users
- `bootcampId` — foreign key → bootcamps
- `createdAt` — timestamp of enrollment creation

## Important Rules

- one student can be enrolled in many bootcamps
- one bootcamp can have many enrolled students
- one student cannot be enrolled in the same bootcamp more than once
- access to a bootcamp is granted only when an enrollment record exists
- role does not grant bootcamp access by itself
- payment is not represented in this table for version 1

## Version 1 Business Rule

For version 1 of the system:

- payments happen outside the system
- students send payment receipts to admins externally
- admins review payments manually outside the system
- admins then enroll students into bootcamps inside the system

Because of that:

- this module does **not** store payment records
- this module does **not** store receipt verification data
- this module stores only the final approved access relationship

## Why This Table Is Important

This is one of the most important tables in the LMS because it defines:

- who has access to which bootcamp
- which bootcamps should appear in a student’s enrolled view
- which students belong to a bootcamp

This is the main table used to enforce LMS access in version 1.

## Constraint Expectations

Expected constraints include:

- primary key on `id`
- foreign key on `userId`
- foreign key on `bootcampId`
- unique constraint on `(userId, bootcampId)`

### Required uniqueness rule

A student must not be enrolled into the same bootcamp twice.

So this module must enforce:

- unique `(userId, bootcampId)`

at the database level.

## Relationship Expectations

This module creates a many-to-many relationship between:

- `users`
- `bootcamps`

using the `enrollments` table as the relationship table.

## Future Extension Notes

Later, this module may be extended with additional fields if business requirements change, such as:

- `createdBy` (which admin enrolled the student)
- enrollment status
- manual notes
- access start date
- access end date

These are not required for the current MVP and should not be added unless needed.

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
   - may record enrollment actions performed by admins

## Relationship to Audit Logging

This module does not own the audit log table, but important actions from this module should later be recorded by **06-audit-logs**, such as:

- admin enrolls student into bootcamp
- future enrollment removal actions if added

## Definition of Done

- [ ] `enrollments` table is defined.
- [ ] `userId` references `users`.
- [ ] `bootcampId` references `bootcamps`.
- [ ] duplicate enrollment is prevented with a unique constraint.
- [ ] schema reflects the version 1 manual admin-enrollment workflow.
- [ ] SQL ownership and dependency order are clear.
