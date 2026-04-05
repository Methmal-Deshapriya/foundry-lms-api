# Module: Architecture & Foundation

## What This Module Covers

This is not a normal business feature module. It defines the **backend foundation** of Foundry LMS.

It explains how the backend is structured, how all layers should work together, what shared technical building blocks must exist before feature development starts, and what rules every other module must follow.

This module is the base for all upcoming modules such as:

- Auth
- Users
- Bootcamps
- Enrollments
- Audit Logs

Without this module being clear, feature modules can become inconsistent, hard to maintain, and harder for coding agents to implement correctly.

---

## What Belongs Here (Documentation Only)

- Overall backend architecture and layer order.
- Shared engineering rules for backend development.
- Folder and file organization standards.
- Environment and configuration expectations.
- Shared technical foundations needed before feature modules.
- Rules for how modules should interact with shared utilities, middlewares, constants, models, and repositories.
- Cross-cutting backend concerns such as:
  - error handling
  - response format
  - authentication middleware foundation
  - authorization middleware foundation
  - Prisma setup
  - validation strategy
  - auditing integration pattern

---

## What We Build First (Before Feature Modules)

1. **Project Structure**
   - Create and confirm the backend folder structure.
   - Ensure folders match the planned modular layered architecture.
   - Ensure naming conventions are defined before implementation.

2. **Environment & Configuration**
   - Create `.env` and `.env.example`.
   - Define environment variables clearly.
   - Centralize environment loading and validation through config files.

3. **Core Express App Setup**
   - `app.js`
   - `index.js`
   - base middleware setup
   - base route registration
   - health check endpoint

4. **Database Foundation**
   - Prisma initialization
   - PostgreSQL connection setup
   - initial schema planning
   - migrations strategy
   - shared Prisma client access

5. **Shared Response & Error Handling**
   - standard API response structure
   - reusable error classes
   - centralized error-handling middleware

6. **Authentication Foundation**
   - JWT utility
   - HTTP-only cookie strategy
   - `authenticate` middleware
   - `requireRole` middleware

7. **Validation Foundation**
   - Decide how request validation will be handled with `zod`
   - define where schemas live
   - define how validation errors are returned

8. **Audit Logging Foundation**
   - define how services should write audit logs
   - define the shared audit logging pattern for future modules

---

## Environment & Config Checklist

| Purpose             | Env / config                                     |
| ------------------- | ------------------------------------------------ |
| App                 | `PORT`, `NODE_ENV`, API base settings            |
| Database            | PostgreSQL connection string for Prisma          |
| Auth                | JWT secret, JWT expiry                           |
| Cookies             | cookie name, cookie security settings            |
| CORS                | allowed frontend origin(s)                       |
| Audit               | audit-related config if needed later             |
| Logging             | logging level or runtime logging options         |
| Future integrations | placeholder envs for storage, email, queue, etc. |

---

## Backend Structure (Reference)

The backend should follow this structure:

- **routes** – define endpoints and attach middlewares
- **controllers** – handle request/response only
- **services** – business logic and use-case orchestration
- **repositories** – Prisma/database access only
- **models** – shape and transform output data
- **middlewares** – auth, role checks, error handling
- **constants** – static shared values
- **utils** – shared helpers such as Prisma client, JWT helper, response handler, error classes

Important note:

- `utils/` must remain organized
- it should not become a random dump folder
- shared helpers should be clearly named and intentionally placed

---

## Layer Order Rule

Every module in this project must follow this layer order:

```txt
Route → Controller → Service → Repository → Data Source
```
