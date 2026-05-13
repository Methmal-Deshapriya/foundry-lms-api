# Enrollment & Access Control: Deep-Dive & Implementation Guide

This document provides a comprehensive overview of the **Enrollments Module** in the **Foundry LMS Backend**. It serves as a study guide for understanding many-to-many relationships and administrative workflows.

---

## 1. The Relational Architecture

The Enrollment module acts as the "Bridge" between the **Identity** (Users) and the **Product** (Bootcamps).

1.  **Repository (`src/repositories/v1/enrollments/enrollment.repository.js`)**: Uses Prisma's `include` feature to perform SQL Joins. This allows us to fetch a User or Bootcamp along with the Enrollment record in a single query.
2.  **Model (`src/models/v1/enrollments/enrollment.model.js`)**: Handles **Nested Sanitization**. It uses the existing Bootcamp and User models to ensure that even when data is nested, it remains safe and professional.
3.  **Service (`src/services/v1/enrollments/enrollment.service.js`)**: Orchestrates three different modules. It talks to the User Repo, the Bootcamp Repo, and the Enrollment Repo to ensure a valid connection is made.

---

## 2. Key Technical Concepts

### **A. Composite Unique Keys**
- **The Concept:** In `schema.prisma`, we defined `@@unique([userId, bootcampId])`.
- **Why?** This ensures a student cannot be enrolled in the same course twice. If an Admin tries to do this, the database will throw a "Unique Constraint" error, which our foundation catches and turns into a `409 Conflict`.

### **B. Module Orchestration**
- **The Logic:** The Enrollment Service is a "Cross-Module" service.
- **The Pattern:** It imports repositories from other modules (`users` and `bootcamps`) to verify existence before creating a relationship. This is the correct way to handle dependencies between features.

### **C. Global Route Protection**
- **The Code:** `router.use(authenticate)` at the top of the route file.
- **The Benefit:** Instead of adding the guard to every single line, we protect the entire module at once. This is a "Fail-Safe" pattern—new routes added to this file are protected by default.

---

## 3. Testing the Module (Postman Instructions)

Follow this sequence to verify the "Offline Payment to Access" workflow.

### **Step 1: Get Your IDs**
1. **List Users:** Call `GET /api/v1/users` (as Admin). Copy a Student's `id`.
2. **List Bootcamps:** Call `GET /api/v1/bootcamps/admin` (as Admin). Copy a Bootcamp's `id`.

### **Step 2: Admin Enrolls a Student**
1. **Login** as `SUPER_ADMIN`.
2. **Method:** POST
3. **URL:** `http://localhost:5000/api/v1/enrollments`
4. **Body (JSON):**
```json
{
  "userId": "PASTE_STUDENT_ID_HERE",
  "bootcampId": "PASTE_BOOTCAMP_ID_HERE"
}
```
5. **Expect:** `201 Created`.

### **Step 3: Test Duplicate Protection**
1. Click **Send** again with the same IDs.
2. **Expect:** `409 Conflict` with the message "Student is already enrolled."

### **Step 4: Student Checks Their "Backpack"**
1. **Login** as the **Student** you just enrolled.
2. **Method:** GET
3. **URL:** `http://localhost:5000/api/v1/enrollments/my`
4. **Expect:** A list containing the enrollment, **plus** the full details of the bootcamp (title, price, etc.).

### **Step 5: Admin Checks "Class List"**
1. **Login** back as `SUPER_ADMIN`.
2. **Method:** GET
3. **URL:** `http://localhost:5000/api/v1/enrollments/bootcamp/{BOOTCAMP_ID}`
4. **Expect:** A list of all students currently in that course.

---

### Study Tip:
Look at the `enrollment.repository.js` file. Notice how we use the `userId_bootcampId` shortcut in the `where` clause. Prisma creates this specific "Name" for the unique constraint we defined in the schema!
