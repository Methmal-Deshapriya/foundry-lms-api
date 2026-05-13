# Shared Foundation: Deep-Dive & Implementation Guide

This document provides a comprehensive overview of the foundational architecture implemented for the **Foundry LMS Backend**. It serves as a study guide for understanding professional Node.js/Express patterns.

---

## 1. The Error & Response System (The "Language")

Predictability is the most important feature of a professional API. We implemented a "Two-Pillar" system to handle communication.

### **Pillar A: Standardized Errors (`src/utils/Errors.js`)**
We use **Class Inheritance** to create a family of errors. 
- **The Concept:** Instead of generic strings, we throw "Typed Objects."
- **Why?** It allows the system to know the exact HTTP status code (400, 401, 404, etc.) without the developer manually typing it every time.
- **Key Logic:** `Error.captureStackTrace` ensures we can debug exactly where an error was "born."

### **Pillar B: Standardized Responses (`src/utils/responseHandler.js`)**
We use the `ApiResponse` utility to ensure every success and failure follows the same JSON structure.
- **Why?** It makes the Frontend developer's life easy. They only have to write one "handler" for all API responses.
- **The "Smart" `send` Method:** It automatically detects the status code from the error object, making Controllers very clean.

---

## 2. The Database Layer (Modern Prisma 7)

We implemented a modern (April 2026) database foundation using **Prisma 7.7.0**.

### **The Singleton Pattern (`src/utils/prisma.js`)**
We ensure the entire app uses **one single instance** of the `PrismaClient`.
- **Why?** Database connections are expensive. If every request created a new connection, the database would crash under high load.

### **Global Omit API (Security First)**
In Prisma 7, we configured the client to **globally omit** the `password` field from the `User` model.
- **Why?** It is a "Fail-Safe." Even if a developer forgets to hide a password in a specific query, the database engine itself will refuse to send it.

---

## 3. The Auth & Security Foundation (The "Guards")

We use a "Layered Security" approach to protect the LMS.

### **JWT (The "Digital Passport") (`src/utils/jwt.js`)**
- **Stateless Auth:** The server doesn't "remember" users. It trusts the **JWT (JSON Web Token)** because it is signed with a secret key.
- **Payload:** We only store the `id` and `role`. This is enough to identify the user without asking the database for every single request.

### **HTTP-Only Cookies**
- **The Concept:** The JWT is stored in a cookie that JavaScript cannot read.
- **Why?** It prevents **XSS (Cross-Site Scripting)** attacks. Even if a hacker runs a script in your browser, they cannot "see" or steal your token.

### **The Middleware Guards**
1.  **`authenticate.js`**: The "Front Door." It checks if you have a valid passport (JWT).
2.  **`requireRole.js`**: The "V.I.P Guard." It checks if your "Passport" has the correct clearance level (e.g., `ADMIN`).
    - **Pro Pattern:** It uses a **Higher-Order Function** to build custom guards for different routes.

---

## 4. The Global Error Handler (The "Safety Net")

The **`errorHandler.js`** is the most critical piece of the "Waterfall."

- **Where it lives:** At the very bottom of `src/app.js`.
- **The 4-Argument Rule:** Express only recognizes it as an error handler if it has `(err, req, res, next)`.
- **The Logic:** 
    1. It catches any error that "falls" through the routes.
    2. It logs the **real** error to `logger.js` for the developer.
    3. It sends a **clean** message to the user.

---

## 5. The Express "Waterfall" (`src/app.js`)

In Express, **Order is Everything**. The request flows like a waterfall:
1.  **Body Parsers:** To read the incoming data.
2.  **Cookie Parsers:** To read the security token.
3.  **Routes:** Where the actual logic lives.
4.  **Error Handler:** The net at the bottom of the waterfall to catch any mistakes.

---

### Study Tip:
When you have time, try to "trip" the system! 
- Go to `src/app.js` and intentionally make a typo in a route. 
- Visit that route in your browser. 
- Watch how the **Error Handler** catches the typo and the **Logger** tells you exactly which line is broken. 

This is the power of a professional foundation.
