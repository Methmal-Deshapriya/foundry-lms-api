# User Management & RBAC: Deep-Dive & Implementation Guide

This document provides a comprehensive overview of the **Users Module** in the **Foundry LMS Backend**. It serves as a study guide for understanding administrative control and Role-Based Access Control (RBAC).

---

## 1. The Architecture of Management

Administrative actions follow the same strict **Layered Architecture**, but with enhanced security guards:

1.  **Route (`src/routes/v1/users/user.routes.js`)**: The "Security Map." It defines permissions using the `requireRole` middleware.
2.  **Controller (`src/controllers/v1/users/user.controller.js`)**: The "Administrative Clerk." It extracts User IDs from URL parameters (`/:id`).
3.  **Service (`src/services/v1/users/user.service.js`)**: The "Safety Gate." It ensures that roles are changed correctly (e.g., preventing demotion of Super Admins).
4.  **Repository (`src/repositories/v1/users/user.repository.js`)**: The "Librarian." It handles the Prisma queries for listing and updating user roles.

---

## 2. Key Administrative Concepts

### **A. Role-Based Access Control (RBAC)**
- **The Concept:** Users are granted permissions based on their "Role" (rank) in the system.
- **The Hierarchy:**
    - `STUDENT`: Can access their own data.
    - `ADMIN`: Can manage content and enrollments.
    - `SUPER_ADMIN`: Has full control, including managing other Admins.
- **The Implementation:** We use the `requireRole(['ROLE_NAME'])` middleware to wrap protected routes.

### **B. The Constants Pattern (`src/constants/...`)**
- **The Problem:** Typing `"SUPER_ADMIN"` everywhere leads to typos.
- **The Solution:** We created a `ROLES` constant object.
- **The Benefit:** It provides autocompletion in your editor and a single source of truth for all role names.

### **C. URL Parameters (`req.params`)**
- **The Concept:** Using the URL to target a specific resource (e.g., `/users/123/promote`).
- **The Code:** `router.patch("/:id/promote", ...)` makes the ID available inside the controller via `req.params.id`.

---

## 3. Testing the Feature (Postman/Insomnia)

To test the User Management features, you **must** be logged in as a user with the correct role.

### **Step 0: Prepare your "God Mode" Account**
1. Open **Prisma Studio**: `npx prisma studio`.
2. Find your test user.
3. Manually change their role to `SUPER_ADMIN`.
4. Click "Save 1 change."

### **Step 1: Get the List of Users**
1. **Method:** GET
2. **URL:** `http://localhost:5000/api/v1/users`
3. **Requirement:** Ensure you are logged in (Postman Cookie Jar must have the `token`).
4. **Expect:** A list of all users, sorted by date (newest first).

### **Step 2: Promote a User**
1. Find another user's ID from the list you just fetched.
2. **Method:** PATCH
3. **URL:** `http://localhost:5000/api/v1/users/{TARGET_ID}/promote`
4. **Expect:** The user's role changes to `ADMIN`.

### **Step 3: Test Security (The "Forbidden" Check)**
1. Register a **new** user.
2. Log in as that new user (they will be a `STUDENT`).
3. Try to call `GET /api/v1/users`.
4. **Expect:** A **403 Forbidden** error. Our foundation is working!

### **Step 4: Test Safety Rules**
1. As a `SUPER_ADMIN`, try to demote **yourself**.
2. **Method:** PATCH
3. **URL:** `http://localhost:5000/api/v1/users/{YOUR_ID}/demote`
4. **Expect:** A **403 Forbidden** error (or a logic error you defined). 
    - *Note: Our current service prevents demoting ANY Super Admin for safety.*

---

### Study Tip:
Look at the **`user.model.js`** file. Notice how we use `.map()` to sanitize the whole list of users at once. This is a very common pattern when returning arrays of data in an API.
