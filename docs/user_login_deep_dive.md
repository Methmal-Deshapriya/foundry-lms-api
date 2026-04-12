# User Login: Deep-Dive & Implementation Guide

This document provides a comprehensive overview of the **User Login** feature in the **Foundry LMS Backend**. It serves as a study guide for understanding professional patterns for user authentication and security.

---

## 1. The Architecture of Login

We follow the same **Layered Architecture** as registration, but with a focus on **Verification**:

1.  **Route (`src/routes/v1/auth/auth.routes.js`)**: The "Sign on the Door." It defines the URL (`/login`) and the method (`POST`).
2.  **Controller (`src/controllers/v1/auth/auth.controller.js`)**: The "Front Desk." It handles HTTP requests, reads the JSON body, and sets the secure **HTTP-only cookie**.
3.  **Service (`src/services/v1/auth/auth.service.js`)**: The "Brain." It handles **Validation** (using the new `loginSchema`), **Security** (Bcrypt comparison), and **Orchestration**.
4.  **Repository (`src/repositories/v1/auth/auth.repository.js`)**: The "Librarian." We use the special `findUserWithPassword` function to bypass the global security omit and fetch the password hash.

---

## 2. Key Security Concepts for Login

### **A. Password Verification (Bcrypt Compare)**
- **The Concept:** We **cannot** decrypt a password hash. Instead, we use `bcrypt.compare(plainText, hashedPassword)`.
- **The Magic:** Bcrypt hashes the plain text input using the same "Salt" from the database hash. If the results are identical, the password is correct.
- **The Benefit:** No one (including you, the developer) ever sees the plain password of a user.

### **B. The "Vague Error" Standard**
- **The Rule:** If a login fails, we **never** say "Email not found" or "Incorrect password."
- **The Reason:** We don't want to give hackers "hints" about whether an email exists in our system.
- **The Implementation:** We always return a generic `401 Unauthorized` message: `"Invalid email or password."`

### **C. The "Emergency Key" (Bypassing Omit)**
- **The Context:** Our **Prisma Client** normally hides passwords for safety.
- **The Problem:** We **need** the password hash for login verification.
- **The Solution:** We created `findUserWithPassword`. It uses `omit: { password: false }` to fetch the password *only* for this specific query.

---

## 3. Testing the Feature (Postman/Insomnia)

To test your new Login feature, follow these steps:

### **Step 1: Register a User (if you haven't already)**
- **Method:** POST
- **URL:** `http://localhost:5000/api/v1/auth/register`
- **Body:** `{ "name": "John", "email": "john@example.com", "password": "password123" }`

### **Step 2: Prepare the Login Request**
1.  **Method:** Set to **POST**.
2.  **URL:** `http://localhost:5000/api/v1/auth/login`
3.  **Headers:** Ensure `Content-Type` is set to `application/json`.
4.  **Body:** Select **raw** and **JSON**. 

### **Step 3: Provide Login Credentials**
Paste this JSON into the body:
```json
{
  "email": "john@example.com",
  "password": "password123"
}
```

### **Step 4: Analyze the Response**
- **Success (200 OK):** You should see your user object (without the password!) and a `"Login successful"` message.
- **Check Cookies:** Look at the "Cookies" tab in Postman. You should see a cookie named `token`. This is your user's new "Passport."

### **Step 5: Test Errors (Security Check)**
1.  **Wrong Password:** Change the password to `"wrong-password"` and click "Send." You should get a **401 Unauthorized** error.
2.  **Wrong Email:** Change the email to `"fake@example.com"` and click "Send." You should get the **same 401 Unauthorized** error. 
    - *This confirms our "Vague Error" security is working!*

---

### Study Tip:
Notice that the **User Object** in the login response looks exactly the same as the one in the registration response. This is because both features use the same **`authModel.toUserResponse`** function. This is the power of **Reusability** in backend engineering!
