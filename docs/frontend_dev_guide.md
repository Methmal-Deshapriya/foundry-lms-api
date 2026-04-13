# Foundry LMS Frontend Developer Guide

This document is a practical handover guide for the frontend developer who will build the Next.js application against the Foundry LMS MVP backend.

It explains:

- how the backend is structured
- how authentication works
- what modules exist
- which endpoints are available
- what each endpoint returns
- how the frontend should call them
- what screens and flows should be built around them

This guide is written from the current implementation in the backend codebase, not from assumptions.

---

## 1. High-Level Overview

The backend is an Express.js API with a layered architecture:

`Route -> Controller -> Service -> Repository -> Prisma/PostgreSQL`

Main backend app entry:

- `src/app.js`
- `src/index.js`

Registered API modules:

- `Auth`
- `Users`
- `Bootcamps`
- `Enrollments`
- `Audit`

Base API prefix:

```txt
/api/v1
```

Health check endpoint:

```txt
GET /api/health
```

Current local backend port:

```txt
http://localhost:5000
```

Current allowed frontend origin from backend CORS config:

```txt
http://localhost:3000
```

That means the current intended local setup is:

- Next.js frontend on `http://localhost:3000`
- Express backend on `http://localhost:5000`

---

## 2. Backend Domain Model

The current Prisma schema defines 4 core entities.

### 2.1 User

Represents a platform account.

Key fields:

- `id`
- `name`
- `email`
- `phone` optional in DB, but not currently exposed in API responses
- `password` stored hashed, never returned by API
- `role`
- `createdAt`
- `updatedAt`

Possible roles:

- `STUDENT`
- `ADMIN`
- `SUPER_ADMIN`

### 2.2 Bootcamp

Represents a learning product / course listing.

Key fields:

- `id`
- `title`
- `slug`
- `description`
- `price`
- `isPublished`
- `createdAt`
- `updatedAt`

### 2.3 Enrollment

Represents access of a user to a bootcamp.

Key fields:

- `id`
- `userId`
- `bootcampId`
- `createdAt`

Important rule:

- a user can only be enrolled once per bootcamp

This is enforced by a database unique constraint on `(userId, bootcampId)`.

### 2.4 AuditLog

Represents background activity logs for admin-level actions.

Key fields:

- `id`
- `actorUserId`
- `action`
- `entityType`
- `entityId`
- `description`
- `metadata`
- `createdAt`

---

## 3. Response Format Conventions

The API is very consistent.

### 3.1 Success shape

Successful responses use this shape:

```json
{
  "success": true,
  "data": {},
  "message": "Success"
}
```

Notes:

- `data` may be an object, array, or omitted if `null`
- `message` is almost always present

Example:

```json
{
  "success": true,
  "data": {
    "id": "8db3d2e8-61f7-4b11-8582-c7c0e4df93a7",
    "name": "Jane Doe",
    "email": "jane@example.com",
    "role": "STUDENT",
    "createdAt": "2026-04-12T18:40:00.000Z"
  },
  "message": "Login successful"
}
```

### 3.2 Error shape

Failed responses use this shape:

```json
{
  "success": false,
  "error": "Human readable message",
  "code": "ERROR_CODE",
  "field": "optionalFieldName",
  "details": "optional extra details"
}
```

Common error codes from current implementation:

- `VALIDATION_ERROR`
- `UNAUTHORIZED`
- `FORBIDDEN`
- `NOT_FOUND`
- `CONFLICT`
- `DATABASE_ERROR`
- `INTERNAL_SERVER_ERROR`

Frontend recommendation:

- always read `success`
- on failure, show `error`
- if `field` exists, attach it to the relevant form field

---

## 4. Authentication Model

Authentication is cookie-based, not bearer-token-in-localStorage.

### 4.1 How login state works

When a user registers or logs in successfully, the backend sets an HTTP-only cookie named:

```txt
token
```

That cookie contains the JWT.

The browser sends that cookie automatically on future requests if the request is made with credentials enabled.

### 4.2 Cookie settings currently used by backend

From `src/controllers/v1/auth/auth.controller.js`:

- `httpOnly: true`
- `secure: process.env.NODE_ENV === "production"`
- `maxAge: 24 * 60 * 60 * 1000`
- `sameSite: "strict"`

Meaning for frontend:

- the frontend cannot read the token with JavaScript
- the frontend must rely on `/auth/me` to know current login state
- requests must be sent with credentials enabled

### 4.3 Frontend fetch rule

Every authenticated request must include credentials.

With `fetch`:

```ts
await fetch("http://localhost:5000/api/v1/auth/me", {
  method: "GET",
  credentials: "include",
});
```

With Axios:

```ts
axios.get("http://localhost:5000/api/v1/auth/me", {
  withCredentials: true,
});
```

### 4.4 Important production note

Based on current backend code, `sameSite` is set to `"strict"` and CORS origin is hardcoded to `http://localhost:3000`.

That is fine for local development when frontend and backend both use `localhost`, but if production frontend and backend are hosted on different sites/subdomains, cookie behavior and CORS config may need backend changes.

For MVP handoff, assume the current intended integration is:

- local frontend on `localhost:3000`
- local backend on `localhost:5000`

---

## 5. Authorization Model

Authorization is role-based.

### 5.1 Role summary

- `STUDENT`
  - can use public endpoints
  - can access their own enrollments

- `ADMIN`
  - can manage bootcamps
  - can enroll students into bootcamps
  - can view bootcamp class lists

- `SUPER_ADMIN`
  - everything an admin can do
  - plus manage user roles
  - plus view audit logs

### 5.2 Frontend rule

Never rely only on hidden buttons.

The frontend should hide admin-only UI for better UX, but the real source of truth is always the backend role check.

Recommended flow:

1. call `GET /api/v1/auth/me`
2. store returned user in app auth state
3. derive UI access from `user.role`

---

## 6. Module-by-Module API Guide

## 6.1 Auth Module

Base path:

```txt
/api/v1/auth
```

Purpose:

- registration
- login
- logout
- current authenticated user lookup

### 6.1.1 POST `/api/v1/auth/register`

Creates a new user account and logs them in immediately by setting the auth cookie.

Access:

- Public

Request body:

```json
{
  "name": "Test User",
  "email": "test@example.com",
  "password": "password123"
}
```

Validation rules:

- `name` minimum 2 characters
- `email` must be valid email format
- `password` minimum 8 characters

Behavior:

- creates user with role `STUDENT`
- hashes password with bcrypt
- sets `token` cookie

Success response:

- HTTP `201`

Response `data` shape:

```json
{
  "id": "uuid",
  "name": "Test User",
  "email": "test@example.com",
  "role": "STUDENT",
  "createdAt": "2026-04-12T18:40:00.000Z"
}
```

Useful frontend behavior:

- after successful signup, treat user as logged in
- redirect to bootcamps page, dashboard, or onboarding page

Possible errors:

- `400 VALIDATION_ERROR`
- `409 CONFLICT` when email already exists

### 6.1.2 POST `/api/v1/auth/login`

Logs in a user and sets auth cookie.

Access:

- Public

Request body:

```json
{
  "email": "test@example.com",
  "password": "password123"
}
```

Validation rules:

- `email` must be valid email format
- `password` required

Success response:

- HTTP `200`

Response `data` shape:

```json
{
  "id": "uuid",
  "name": "Test User",
  "email": "test@example.com",
  "role": "STUDENT",
  "createdAt": "2026-04-12T18:40:00.000Z"
}
```

Possible errors:

- `400 VALIDATION_ERROR`
- `401 UNAUTHORIZED` with message like `Invalid email or password.`

Frontend notes:

- do not expect the token in JSON
- it is only set as cookie
- after login, call `/auth/me` if you want to re-hydrate session state from server

### 6.1.3 POST `/api/v1/auth/logout`

Clears auth cookie.

Access:

- Public

Request body:

- none

Success response:

- HTTP `200`

Example:

```json
{
  "success": true,
  "data": {
    "message": "Logout successful"
  },
  "message": "Logout successful"
}
```

Frontend notes:

- after logout, clear client auth state
- redirect to home or sign-in

### 6.1.4 GET `/api/v1/auth/me`

Returns the currently authenticated user from the cookie session.

Access:

- Private

Request:

- no body
- must include credentials

Success response:

- HTTP `200`

Response `data` shape:

```json
{
  "id": "uuid",
  "name": "Test User",
  "email": "test@example.com",
  "role": "STUDENT",
  "createdAt": "2026-04-12T18:40:00.000Z"
}
```

Possible errors:

- `401 UNAUTHORIZED` if cookie missing, invalid, or expired
- `404 NOT_FOUND` if user no longer exists

Frontend use cases:

- app boot auth check
- protected route guard
- navbar user state
- role-based dashboard switching

---

## 6.2 Users Module

Base path:

```txt
/api/v1/users
```

Purpose:

- user management for admins
- role promotion and demotion

### 6.2.1 GET `/api/v1/users`

Returns all users.

Access:

- `ADMIN`
- `SUPER_ADMIN`

Success response:

- HTTP `200`

Response `data` shape:

```json
[
  {
    "id": "uuid",
    "name": "Jane Doe",
    "email": "jane@example.com",
    "role": "STUDENT",
    "createdAt": "2026-04-12T18:40:00.000Z",
    "updatedAt": "2026-04-12T18:40:00.000Z"
  }
]
```

Sorting:

- newest users first

Frontend screens supported:

- admin user list
- user management table
- role badges and promotion actions

Possible errors:

- `401 UNAUTHORIZED`
- `403 FORBIDDEN`

### 6.2.2 PATCH `/api/v1/users/:id/promote`

Promotes a target user to `ADMIN`.

Access:

- `SUPER_ADMIN` only

Request body:

- none

Success response:

- HTTP `200`

Response `data` shape:

```json
{
  "id": "uuid",
  "name": "Jane Doe",
  "email": "jane@example.com",
  "role": "ADMIN",
  "createdAt": "2026-04-12T18:40:00.000Z",
  "updatedAt": "2026-04-13T10:00:00.000Z"
}
```

Business rules:

- cannot promote someone already `ADMIN`
- cannot promote someone already `SUPER_ADMIN`

Possible errors:

- `404 NOT_FOUND` target user missing
- `409 CONFLICT` already admin/super admin
- `401 UNAUTHORIZED`
- `403 FORBIDDEN`

### 6.2.3 PATCH `/api/v1/users/:id/demote`

Demotes a target admin back to `STUDENT`.

Access:

- `SUPER_ADMIN` only

Request body:

- none

Success response:

- HTTP `200`

Response `data` shape:

```json
{
  "id": "uuid",
  "name": "Jane Doe",
  "email": "jane@example.com",
  "role": "STUDENT",
  "createdAt": "2026-04-12T18:40:00.000Z",
  "updatedAt": "2026-04-13T10:05:00.000Z"
}
```

Business rules:

- `SUPER_ADMIN` cannot be demoted via this endpoint
- a `STUDENT` cannot be demoted again

Possible errors:

- `404 NOT_FOUND`
- `403 FORBIDDEN`
- `409 CONFLICT`

Frontend recommendation:

- show promote/demote buttons only to `SUPER_ADMIN`
- refetch user list after success

---

## 6.3 Bootcamps Module

Base path:

```txt
/api/v1/bootcamps
```

Purpose:

- public course marketplace
- admin bootcamp management

Important route design note:

- `/admin` exists and is intentionally declared before `/:slug`
- public detail view uses `slug`
- admin edit/delete/publish/unpublish use `id`

### Public bootcamp endpoints

### 6.3.1 GET `/api/v1/bootcamps`

Returns all published bootcamps.

Access:

- Public

Success response:

- HTTP `200`

Response `data` shape:

```json
[
  {
    "id": "uuid",
    "title": "Mastering Node.js",
    "slug": "mastering-node-js",
    "description": "The ultimate backend course.",
    "price": 49.99,
    "createdAt": "2026-04-12T18:40:00.000Z"
  }
]
```

Notes:

- only returns `isPublished = true`
- `isPublished` is not included in public response

Frontend use cases:

- public bootcamp listing page
- home page featured courses
- marketplace cards

### 6.3.2 GET `/api/v1/bootcamps/:slug`

Returns one published bootcamp by slug.

Access:

- Public

Success response:

- HTTP `200`

Response `data` shape:

```json
{
  "id": "uuid",
  "title": "Mastering Node.js",
  "slug": "mastering-node-js",
  "description": "The ultimate backend course.",
  "price": 49.99,
  "createdAt": "2026-04-12T18:40:00.000Z"
}
```

Important behavior:

- if slug does not exist, returns `404`
- if bootcamp exists but is unpublished, also returns `404`

This means draft bootcamps are hidden from public users.

Frontend use cases:

- `/bootcamps/[slug]` detail page
- course landing page

### Admin bootcamp endpoints

### 6.3.3 GET `/api/v1/bootcamps/admin`

Returns all bootcamps for admin management, including drafts.

Access:

- `ADMIN`
- `SUPER_ADMIN`

Success response:

- HTTP `200`

Response `data` shape:

```json
[
  {
    "id": "uuid",
    "title": "Mastering Node.js",
    "slug": "mastering-node-js",
    "description": "The ultimate backend course.",
    "price": 49.99,
    "isPublished": false,
    "createdAt": "2026-04-12T18:40:00.000Z",
    "updatedAt": "2026-04-12T18:40:00.000Z"
  }
]
```

Frontend screens supported:

- admin bootcamp table
- draft/published management dashboard

### 6.3.4 POST `/api/v1/bootcamps`

Creates a new bootcamp.

Access:

- `ADMIN`
- `SUPER_ADMIN`

Request body:

```json
{
  "title": "Mastering Node.js",
  "slug": "mastering-node-js",
  "description": "The ultimate backend course.",
  "price": 49.99
}
```

Validation rules:

- `title` minimum 3 characters
- `slug` must match lowercase URL-safe pattern
- `price` must be a number and cannot be negative
- `description` optional

Important frontend note:

- `price` must be sent as a number, not a string
- `slug` should be lowercase with letters, numbers, and dashes only

Success response:

- HTTP `201`

Response `data` shape:

```json
{
  "id": "uuid",
  "title": "Mastering Node.js",
  "slug": "mastering-node-js",
  "description": "The ultimate backend course.",
  "price": 49.99,
  "isPublished": false,
  "createdAt": "2026-04-12T18:40:00.000Z",
  "updatedAt": "2026-04-12T18:40:00.000Z"
}
```

Likely flow:

- create draft
- later publish using dedicated endpoint

Possible errors:

- `400 VALIDATION_ERROR`
- `409 CONFLICT` duplicate slug

### 6.3.5 PATCH `/api/v1/bootcamps/:id`

Updates a bootcamp by ID.

Access:

- `ADMIN`
- `SUPER_ADMIN`

Request body:

All fields optional:

```json
{
  "title": "Updated title",
  "slug": "updated-slug",
  "description": "Updated description",
  "price": 99.99,
  "isPublished": true
}
```

Validation rules:

- same rules as create, but all optional

Success response:

- HTTP `200`

Response `data` shape:

```json
{
  "id": "uuid",
  "title": "Updated title",
  "slug": "updated-slug",
  "description": "Updated description",
  "price": 99.99,
  "isPublished": true,
  "createdAt": "2026-04-12T18:40:00.000Z",
  "updatedAt": "2026-04-13T10:10:00.000Z"
}
```

Possible errors:

- `400 VALIDATION_ERROR`
- `404 NOT_FOUND`
- `409 CONFLICT`

### 6.3.6 DELETE `/api/v1/bootcamps/:id`

Deletes a bootcamp by ID.

Access:

- `ADMIN`
- `SUPER_ADMIN`

Request body:

- none

Success response:

- HTTP `200`

Response example:

```json
{
  "success": true,
  "message": "Bootcamp deleted successfully"
}
```

Frontend recommendation:

- confirm before delete
- remove item from list or refetch admin list

### 6.3.7 PATCH `/api/v1/bootcamps/:id/publish`

Publishes a bootcamp.

Access:

- `ADMIN`
- `SUPER_ADMIN`

Request body:

- none

Success response:

- HTTP `200`

Response `data` shape is the full admin bootcamp object with `isPublished: true`.

### 6.3.8 PATCH `/api/v1/bootcamps/:id/unpublish`

Unpublishes a bootcamp.

Access:

- `ADMIN`
- `SUPER_ADMIN`

Request body:

- none

Success response:

- HTTP `200`

Response `data` shape is the full admin bootcamp object with `isPublished: false`.

Frontend recommendation:

- model publish/unpublish as explicit actions, not just a local toggle
- use returned object to update row state

---

## 6.4 Enrollments Module

Base path:

```txt
/api/v1/enrollments
```

Purpose:

- student course access lookup
- admin enrollment management

Important module behavior:

- all enrollment routes require authentication
- route file applies `authenticate` to entire module with `router.use(authenticate)`

### 6.4.1 GET `/api/v1/enrollments/my`

Returns the current authenticated user's enrollments.

Access:

- any authenticated user

Real-world meaning:

- intended mainly for students
- admins and super admins can still technically call it for their own enrollments

Success response:

- HTTP `200`

Response `data` shape:

```json
[
  {
    "id": "enrollment-uuid",
    "enrolledAt": "2026-04-13T09:00:00.000Z",
    "bootcamp": {
      "id": "bootcamp-uuid",
      "title": "Mastering Node.js",
      "slug": "mastering-node-js",
      "description": "The ultimate backend course.",
      "price": 49.99,
      "createdAt": "2026-04-12T18:40:00.000Z"
    }
  }
]
```

Frontend use cases:

- student dashboard
- my courses page
- enrolled course cards

### 6.4.2 POST `/api/v1/enrollments`

Manually enrolls a student into a bootcamp.

Access:

- `ADMIN`
- `SUPER_ADMIN`

Request body:

```json
{
  "userId": "student-uuid",
  "bootcampId": "bootcamp-uuid"
}
```

Validation rules:

- both must be valid UUIDs

Business rules:

- user must exist
- bootcamp must exist
- duplicate enrollment is blocked

Success response:

- HTTP `201`

Response `data` currently returns the raw enrollment record from the repository:

```json
{
  "id": "enrollment-uuid",
  "userId": "student-uuid",
  "bootcampId": "bootcamp-uuid",
  "createdAt": "2026-04-13T09:00:00.000Z"
}
```

Possible errors:

- `400 VALIDATION_ERROR`
- `404 NOT_FOUND`
- `409 CONFLICT`

Frontend screens supported:

- admin enrollment creation form
- manual student assignment flow

### 6.4.3 GET `/api/v1/enrollments/bootcamp/:bootcampId`

Returns all students enrolled in a specific bootcamp.

Access:

- `ADMIN`
- `SUPER_ADMIN`

Success response:

- HTTP `200`

Response `data` shape:

```json
[
  {
    "id": "enrollment-uuid",
    "enrolledAt": "2026-04-13T09:00:00.000Z",
    "student": {
      "id": "student-uuid",
      "name": "Jane Doe",
      "email": "jane@example.com",
      "role": "STUDENT",
      "createdAt": "2026-04-12T18:40:00.000Z",
      "updatedAt": "2026-04-13T08:00:00.000Z"
    }
  }
]
```

Frontend use cases:

- class roster
- student list inside admin bootcamp detail view

Possible errors:

- `404 NOT_FOUND` if bootcamp missing

---

## 6.5 Audit Module

Base path:

```txt
/api/v1/audit
```

Purpose:

- super-admin system activity history
- filtering and pagination of audit logs

Important note:

- audit events are written in the background from services
- frontend does not write audit logs directly

### 6.5.1 GET `/api/v1/audit/logs`

Returns audit logs with filtering and pagination.

Access:

- `SUPER_ADMIN` only

Supported query params:

- `action`
- `resourceType`
- `actorUserId`
- `entityId`
- `from`
- `to`
- `limit`
- `offset`

Controller mapping note:

- frontend sends `resourceType`
- backend maps it internally to `entityType`

Example request:

```txt
GET /api/v1/audit/logs?action=USER_PROMOTED&resourceType=USER&limit=20&offset=0
```

Success response:

- HTTP `200`

Response `data` shape:

```json
{
  "logs": [
    {
      "id": "audit-uuid",
      "action": "USER_PROMOTED",
      "entityType": "USER",
      "entityId": "user-uuid",
      "description": "User jane@example.com promoted to ADMIN by Admin actor-id",
      "metadata": {
        "oldRole": "STUDENT",
        "newRole": "ADMIN"
      },
      "createdAt": "2026-04-13T10:30:00.000Z",
      "actor": {
        "id": "actor-uuid",
        "name": "Root User",
        "email": "root@example.com",
        "role": "SUPER_ADMIN",
        "createdAt": "2026-04-01T00:00:00.000Z",
        "updatedAt": "2026-04-01T00:00:00.000Z"
      }
    }
  ],
  "pagination": {
    "total": 123,
    "limit": 20,
    "offset": 0,
    "hasMore": true
  }
}
```

Important frontend behavior:

- use `logs` array for display
- use `pagination.hasMore` for load-more or next-page UI
- send ISO-compatible date strings for `from` and `to`

Likely UI:

- filters bar
- log table
- pagination or infinite load more

---

## 7. What the Frontend Should Build

Below is the recommended feature breakdown for the Next.js frontend based on the current backend.

## 7.1 Public-facing pages

### Home page

Current status:

- already started according to project context

Recommended integration:

- optionally load featured bootcamps from `GET /api/v1/bootcamps`
- show only published bootcamps

### Bootcamp listing page

Recommended route:

```txt
/bootcamps
```

API:

- `GET /api/v1/bootcamps`

What to render:

- title
- description
- price
- CTA to bootcamp detail page

### Bootcamp detail page

Recommended route:

```txt
/bootcamps/[slug]
```

API:

- `GET /api/v1/bootcamps/:slug`

What to render from current backend:

- title
- description
- price

Important note:

The current frontend has rich static bootcamp page sections like curriculum, intro video, certificate, and who-it-is-for. The current backend does not yet provide those richer content blocks. So for now:

- either keep those sections static temporarily
- or reduce the live page to fields the backend actually exposes

Do not assume those richer course fields exist in API yet.

## 7.2 Authentication pages

Recommended routes:

- `/sign-in`
- `/sign-up`

Current status:

- existing Next.js pages are placeholders

Required API integration:

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/me`

What to build:

- sign-up form
- sign-in form
- logout button
- session restoration on app load
- loading state while auth is being checked
- protected layout / route guard

## 7.3 Student area

Recommended routes:

- `/dashboard`
- `/my-courses`

Primary API:

- `GET /api/v1/enrollments/my`

What to show:

- enrolled bootcamp list
- bootcamp title
- enrolled date
- deep link to bootcamp page

## 7.4 Admin area

Recommended routes:

- `/admin/bootcamps`
- `/admin/bootcamps/new`
- `/admin/bootcamps/[id]/edit`
- `/admin/bootcamps/[id]/students`
- `/admin/enrollments`
- `/admin/users`

Primary APIs:

- `GET /api/v1/bootcamps/admin`
- `POST /api/v1/bootcamps`
- `PATCH /api/v1/bootcamps/:id`
- `DELETE /api/v1/bootcamps/:id`
- `PATCH /api/v1/bootcamps/:id/publish`
- `PATCH /api/v1/bootcamps/:id/unpublish`
- `GET /api/v1/users`
- `PATCH /api/v1/users/:id/promote`
- `PATCH /api/v1/users/:id/demote`
- `POST /api/v1/enrollments`
- `GET /api/v1/enrollments/bootcamp/:bootcampId`

What to build:

- bootcamp CRUD admin table
- draft/published badge
- publish/unpublish controls
- user management table
- promote/demote actions
- enrollment creation form with user selector and bootcamp selector
- bootcamp roster page

## 7.5 Super admin area

Recommended route:

```txt
/super-admin/audit
```

Primary API:

- `GET /api/v1/audit/logs`

What to build:

- audit log table
- filters for action, resource type, actor, date range
- pagination controls

---

## 8. Recommended Next.js Integration Approach

## 8.1 Environment variable

Create a frontend env variable:

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:5000/api/v1
```

### 8.2 API client wrapper

Use one shared API utility so all requests behave consistently.

Example:

```ts
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL!;

type ApiSuccess<T> = {
  success: true;
  data?: T;
  message?: string;
};

type ApiFailure = {
  success: false;
  error: string;
  code?: string;
  field?: string;
  details?: unknown;
};

type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {}
): Promise<ApiResponse<T>> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });

  return response.json();
}
```

This should be the default for both public and authenticated calls. Public calls do not suffer from sending credentials, and private calls need them.

## 8.3 Suggested frontend state split

- `auth state`
  - current user
  - loading
  - isAuthenticated

- `bootcamp state`
  - public list
  - selected bootcamp
  - admin list

- `enrollment state`
  - my enrollments
  - bootcamp roster

- `user management state`
  - all users

- `audit state`
  - filtered logs
  - pagination

Use whatever state tool the frontend team prefers, but the backend contract is clean enough for:

- plain React state
- Context
- Zustand
- TanStack Query

TanStack Query would be a strong fit for this API because most interactions are standard request/mutation flows with refetching.

---

## 9. Suggested Route Protection Strategy in Next.js

Because auth is cookie-based and the frontend cannot read the token directly, the most reliable check is `/auth/me`.

Recommended pattern:

1. app loads
2. frontend requests `GET /auth/me`
3. if success, store user
4. if `401`, treat user as logged out

Use this for:

- auth-aware navbar
- redirecting guests away from protected pages
- redirecting students away from admin pages
- redirecting admins away from super-admin-only pages

Suggested access rules:

- guest pages
  - home
  - bootcamp list
  - bootcamp detail
  - sign-in
  - sign-up

- authenticated pages
  - dashboard
  - my-courses

- admin-only pages
  - admin bootcamp management
  - admin enrollment tools

- super-admin-only pages
  - user role management actions
  - audit logs

---

## 10. Request and Form Implementation Notes

## 10.1 JSON body expectations

Backend uses `express.json()`, so requests should be sent as JSON.

Set:

```txt
Content-Type: application/json
```

## 10.2 Numeric fields

For bootcamp create/update:

- send `price` as a JavaScript number
- do not send `"49.99"` as a string unless frontend converts it first

## 10.3 Slug generation

Slug must match:

```txt
lowercase letters + numbers + dashes only
```

Frontend should either:

- auto-generate slug from title
- or validate before submit

Example valid slug:

```txt
full-stack-engineering
```

Example invalid slug:

```txt
Full Stack Engineering
```

## 10.4 UUID route params

Several admin endpoints use UUID IDs:

- user promotion/demotion
- bootcamp update/delete/publish/unpublish
- enrollment creation
- bootcamp student list

Do not confuse:

- public bootcamp detail uses `slug`
- admin bootcamp operations use `id`

---

## 11. Practical API Usage Examples

## 11.1 Sign up

```ts
await apiFetch("/auth/register", {
  method: "POST",
  body: JSON.stringify({
    name: "Jane Doe",
    email: "jane@example.com",
    password: "password123",
  }),
});
```

## 11.2 Login

```ts
await apiFetch("/auth/login", {
  method: "POST",
  body: JSON.stringify({
    email: "jane@example.com",
    password: "password123",
  }),
});
```

## 11.3 Load current user

```ts
await apiFetch("/auth/me");
```

## 11.4 Load public bootcamps

```ts
await apiFetch("/bootcamps");
```

## 11.5 Load bootcamp by slug

```ts
await apiFetch(`/bootcamps/${slug}`);
```

## 11.6 Create bootcamp

```ts
await apiFetch("/bootcamps", {
  method: "POST",
  body: JSON.stringify({
    title: "Mastering Node.js",
    slug: "mastering-node-js",
    description: "The ultimate backend course.",
    price: 49.99,
  }),
});
```

## 11.7 Enroll student

```ts
await apiFetch("/enrollments", {
  method: "POST",
  body: JSON.stringify({
    userId: "student-uuid",
    bootcampId: "bootcamp-uuid",
  }),
});
```

## 11.8 Fetch audit logs

```ts
await apiFetch(
  "/audit/logs?action=BOOTCAMP_CREATED&resourceType=BOOTCAMP&limit=20&offset=0"
);
```

---

## 12. Frontend Mapping to Current Next.js Project

The current frontend already contains these relevant areas:

- `app/(main)/page.tsx`
- `app/(main)/bootcamps/page.tsx`
- `app/(main)/bootcamps/[bootcamp]/page.tsx`
- `app/(auth)/sign-in/page.tsx`
- `app/(auth)/sign-up/page.tsx`
- static course data in `data/courses/*`

Current observations:

- `sign-in` page is still a placeholder
- `sign-up` page is still a placeholder
- bootcamp listing page is still a placeholder
- dynamic bootcamp page currently uses static local course data

Recommended migration path:

1. replace bootcamp list placeholder with `GET /bootcamps`
2. replace dynamic bootcamp page source with `GET /bootcamps/:slug`
3. build sign-in form using `/auth/login`
4. build sign-up form using `/auth/register`
5. add auth context initialized by `/auth/me`
6. build student `my-courses` page using `/enrollments/my`
7. build admin dashboard pages after public and auth flows work

---

## 13. Known Backend Limitations the Frontend Should Respect

These are not bugs in the handoff. They are simply current MVP boundaries.

### 13.1 No rich bootcamp content model yet

Current bootcamp API only exposes:

- `title`
- `slug`
- `description`
- `price`
- `createdAt`
- `isPublished` in admin responses

It does not currently expose:

- curriculum sections
- intro video URLs
- instructor data
- hero image URLs
- FAQs
- certificates
- lessons/modules

If the current frontend design needs these, they must remain static for now or the backend must be extended later.

### 13.2 No self-service student enrollment flow yet

Current enrollment creation is admin-only.

That means the frontend should not build a direct student "buy now and unlock instantly" API flow yet unless the backend is extended.

Current intended model is:

- admin manually enrolls student
- student later sees course in `/enrollments/my`

### 13.3 No token refresh flow yet

Current auth is simple session via JWT cookie with 1-day expiry.

If a session expires:

- `/auth/me` returns `401`
- frontend should redirect to sign-in

### 13.4 No pagination on users or bootcamps yet

Current list endpoints return full lists for:

- users
- bootcamps
- enrollments

Only audit logs currently provide pagination metadata.

---

## 14. Recommended Delivery Order for Frontend Work

To help the frontend developer move quickly, this is the best order:

1. Set up shared API client with `credentials: "include"`
2. Implement auth context using `/auth/me`
3. Implement sign-in and sign-up pages
4. Replace public bootcamp list with live API
5. Replace bootcamp detail page with live API
6. Build logout and navbar auth state
7. Build student my-courses page
8. Build admin bootcamp management
9. Build admin enrollment management
10. Build user management for super admin
11. Build audit log page for super admin

This order reduces blockers and gets visible integration working early.

---

## 15. Quick Endpoint Reference

### Public

- `GET /api/health`
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/logout`
- `GET /api/v1/bootcamps`
- `GET /api/v1/bootcamps/:slug`

### Authenticated

- `GET /api/v1/auth/me`
- `GET /api/v1/enrollments/my`

### Admin and Super Admin

- `GET /api/v1/bootcamps/admin`
- `POST /api/v1/bootcamps`
- `PATCH /api/v1/bootcamps/:id`
- `DELETE /api/v1/bootcamps/:id`
- `PATCH /api/v1/bootcamps/:id/publish`
- `PATCH /api/v1/bootcamps/:id/unpublish`
- `POST /api/v1/enrollments`
- `GET /api/v1/enrollments/bootcamp/:bootcampId`
- `GET /api/v1/users`

### Super Admin only

- `PATCH /api/v1/users/:id/promote`
- `PATCH /api/v1/users/:id/demote`
- `GET /api/v1/audit/logs`

---

## 16. Final Handover Summary

If the frontend developer remembers only a few things, they should remember these:

1. This backend uses cookie-based auth, so all frontend requests must send credentials.
2. The frontend should use `/auth/me` as the source of truth for current session state.
3. Public bootcamp pages use `slug`, while admin bootcamp actions use `id`.
4. Student access is based on enrollments, not just login status.
5. Admin actions and super-admin actions are separate because roles matter heavily in this API.
6. The current bootcamp content model is still minimal, so the frontend should not assume rich course-content APIs exist yet.

For backend implementation details, also refer to these existing documents in this project:

- `docs/shared_foundation_deep_dive.md`
- `docs/user_registration_deep_dive.md`
- `docs/user_login_deep_dive.md`
- `docs/user_management_deep_dive.md`
- `docs/bootcamp_management_deep_dive.md`
- `docs/enrollment_management_deep_dive.md`
- `docs/audit_logging_deep_dive.md`
