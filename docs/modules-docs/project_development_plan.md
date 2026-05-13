# Foundry LMS Backend — Project Development Plan

---

## 1. Project Overview

**Foundry LMS** is a learning platform where multiple bootcamps can be created, managed, and accessed by users.

This backend system is responsible for:

- Authentication & authorization
- User and admin management
- Bootcamp management
- Enrollment-based access control
- Audit logging of critical actions

### Architecture

- **Frontend:** Next.js (separate service)
- **Backend:** Node.js + Express.js
- **Database:** PostgreSQL
- **ORM:** Prisma
- **Auth:** JWT (stored in HTTP-only cookies)

---

## 2. Goals & Scope

### 🎯 Main Goal

Build a **clean, scalable, and well-structured backend** while learning proper backend engineering.

---

### ✅ MVP Scope

- Express backend with layered architecture
- Authentication (register, login, logout, me)
- Role-based authorization
- Super Admin support
- Bootcamp CRUD (admin)
- Enrollment system
- Audit logging
- Documentation-first development

---

### ❌ Out of Scope (for now)

- Payments
- Course content (videos, lessons)
- Progress tracking
- Notifications
- Analytics dashboards
- Background jobs

---

### ⚠️ Important MVP Business Rule (VERY IMPORTANT)

In version 1:

- Payments happen **outside the system**
- Students send payment receipts to admins externally (e.g., email)
- Admin verifies the payment manually
- Admin logs into the system and **enrolls the student manually**
- **Enrollment is the action that grants access**

👉 The backend **does NOT**:

- process payments
- verify receipts
- store payment transactions

👉 The backend **ONLY trusts admin action (enrollment)** as access control

---

## 3. Core Mental Model

The system is built around 4 key concepts:

### 1. Identity

Who is the user?

### 2. Role

What system-level authority do they have?

### 3. Enrollment

Which bootcamps can they access?

### 4. Auditing

What actions happened and who performed them?

---

## 4. Roles & Access Control

### Visitor

- Not logged in
- Can view public bootcamps
- Not a database role

---

### Student (`STUDENT`)

- Registered user
- Can log in
- No automatic bootcamp access

---

### Enrolled Student

- A `STUDENT` with bootcamp access via **Enrollment**
- NOT a separate role

---

### Admin (`ADMIN`)

- Manages bootcamps and enrollments
- Performs operational tasks

---

### Super Admin (`SUPER_ADMIN`)

- Full system authority
- Manages admins
- Can promote/demote users
- Controls system-level operations

---

### 🔐 Access Control Rule

- **Role = system authority**
- **Enrollment = bootcamp access**

Never mix these two.

---

## 5. System Architecture

Backend follows strict layering:

```
Route → Controller → Service → Repository → Database
```

### Responsibilities

#### Routes

- Define endpoints
- Attach middleware
- Call controllers only

#### Controllers

- Handle request/response
- Call one service
- No business logic

#### Services

- Business logic
- Validation rules
- Orchestrate repositories
- Trigger audit logs

#### Repositories

- Prisma DB queries only
- No business rules

#### Models

- Shape response data

#### Middlewares

- Authentication
- Authorization
- Error handling

#### Constants

- Roles, limits, config values

#### Utils

- Prisma client
- JWT helper
- Response handler
- Error classes

---

## 6. Request Flow

1. Request hits route
2. Middleware executes (auth, role check)
3. Controller extracts input
4. Service executes logic
5. Repository interacts with DB
6. Service processes result
7. Audit log (if needed)
8. Controller returns response
9. Error handler catches failures

---

## 7. Modules Overview

### 01. Architecture

- Project structure & rules

### 02. Auth

- Register
- Login
- Logout
- Current user

### 03. Users

- List users
- Promote/demote admins

### 04. Bootcamps

- Public listing
- Admin CRUD
- Publish/unpublish

---

### 05. Enrollments

- Admin enrolls students into bootcamps
- Get student bootcamps
- Get bootcamp students
- Access control based on enrollment

👉 This module represents the **final step of the offline payment workflow**

---

### 06. Audit Logs

- Record important actions
- Track system activity

### 07. Shared Foundations

- Errors
- Responses
- Middleware
- Helpers

---

## 8. Data Model

### User

- id, name, email, password
- role (STUDENT, ADMIN, SUPER_ADMIN)
- timestamps

---

### Bootcamp

- id, title, slug, description
- price, isPublished
- timestamps

---

### Enrollment

- id, userId, bootcampId
- createdAt

Constraint:

- Unique (userId + bootcampId)

---

### AuditLog

- id
- actorUserId
- action
- entityType
- entityId
- description
- metadata (JSON)
- createdAt

---

## 9. Auditing Design

### Why auditing?

- Security
- Accountability
- Debugging
- Admin tracking

---

### What to audit?

- Role changes
- Admin promotions/demotions
- Bootcamp create/update/delete
- Publish/unpublish
- Enrollments

---

### Rule

Audit logs must be created **inside services**, not controllers.

---

## 10. API Responsibilities

### Auth APIs

- register
- login
- logout
- me

---

### User/Admin APIs

- list users
- promote user
- demote admin

---

### Bootcamp APIs

- public list
- public detail
- create/update/delete
- publish/unpublish

---

### Enrollment APIs

- enroll student
- get my bootcamps
- get bootcamp students

---

### Audit APIs (future)

- view logs
- filter logs

---

## 11. Development Rules (VERY IMPORTANT)

- One feature at a time
- Do not skip layers
- No business logic in controllers
- No DB access in services
- Always validate input
- Always use consistent responses
- Keep naming clear and predictable
- Do not mix role and enrollment logic

---

## 12. Coding Agent Guidelines

Agents must:

- Follow architecture strictly
- Not invent new patterns
- Respect module boundaries
- Use existing helpers/utilities
- Not duplicate logic
- Not bypass services layer

---

### Prevent these mistakes:

- Logic inside routes/controllers
- Treating enrolled users as a role
- Allowing admins to create admins
- Missing audit logging
- Inconsistent API responses

---

## 13. Scalability & Best Practices

### Design mindset

- Keep modules independent
- Keep services clean
- Avoid deep coupling

---

### Basic scalability considerations

- Stateless API design
- Proper DB indexing (later)
- Avoid N+1 queries
- Validate inputs strictly
- Use consistent error handling

---

### Stress handling

- Prevent duplicate enrollments (DB constraint)
- Validate all inputs
- Handle errors predictably
- Never trust frontend validation

---

## 14. Documentation Strategy

### This document

- Single source of truth
- Always updated

---

### Module docs

Each module must have:

- purpose
- features
- routes
- business rules
- DB notes
- edge cases

---

### Rule

No feature should be implemented without documentation.

---

## 15. Future Extensions

Planned for later:

- Payments integration
- Course content (lessons/videos)
- Progress tracking
- Notifications
- Reports & analytics
- Background jobs
- Role-based permissions beyond simple roles

---

## 16. Final Principle

This backend must be:

- simple to understand
- cleanly structured
- scalable in design
- consistent in behavior
- easy for both humans and AI agents

---

👉 This document is the **single source of truth** for development.
