# User Registration: Deep-Dive & Implementation Guide

This document provides a comprehensive overview of the **User Registration** feature in the **Foundry LMS Backend**. It serves as a study guide for understanding professional patterns for user identity and security.

---

## 1. The Architecture of a Feature

We follow a strict **Layered Architecture**. Every request flows through these 4 layers:

1.  **Route (`src/routes/v1/auth/auth.routes.js`)**: The "Front Door." It defines the URL (`/register`) and the method (`POST`).
2.  **Controller (`src/controllers/v1/auth/auth.controller.js`)**: The "Front Desk." It handles HTTP requests, reads the JSON body, and sets the secure **HTTP-only cookie**.
3.  **Service (`src/services/v1/auth/auth.service.js`)**: The "Brain." It handles **Validation** (Zod), **Security** (Bcrypt hashing), and **Orchestration** (calling the repository and model).
4.  **Repository (`src/repositories/v1/auth/auth.repository.js`)**: The "Librarian." It is the only place that talks to **Prisma** to save the user to PostgreSQL.

---

## 2. Key Security Technologies

### **A. Password Hashing (Bcryptjs)**
- **The Problem:** Storing passwords as plain text is dangerous. If the database is stolen, everyone's account is compromised.
- **The Solution:** We "Hash" the password. A hash is a one-way mathematical function. 
- **Salting:** Bcrypt adds a random string (the "Salt") to the password before hashing. This makes it impossible for hackers to use "Rainbow Tables" to crack your passwords.

### **B. Input Validation (Zod)**
- **The Concept:** We define a "Schema" (a blueprint) for what a registration request must look like.
- **The Rules:**
    - `name`: Must be at least 2 characters.
    - `email`: Must be a valid email format.
    - `password`: Must be at least 8 characters.
- **The Benefit:** It stops bad data before it even touches your database.

### **C. HTTP-Only Cookies**
- **The Concept:** We store the JWT in a cookie that is "HTTP-only."
- **Why?** JavaScript (the browser) cannot read it. This prevents **XSS attacks** where a hacker might try to steal your login token with a malicious script.

---

## 3. Data Transformation (The "Mask")

We use **`src/models/v1/auth/auth.model.js`** to shape our data.
- **The Goal:** Even though we hash the password, we **never** want to send that hash back to the user in the API response.
- **The Solution:** The `toUserResponse` function takes the raw database object and "filters" it, leaving only safe fields like `id`, `name`, and `email`.

---

## 4. Testing the Feature (Postman/Insomnia)

To test your new Registration feature, follow these steps:

### **Step 1: Start the Server**
Ensure your backend is running:
`npm run dev`

### **Step 2: Prepare the Request in Postman**
1.  **Method:** Set to **POST**.
2.  **URL:** `http://localhost:5000/api/v1/auth/register`
3.  **Headers:** Ensure `Content-Type` is set to `application/json`.
4.  **Body:** Select **raw** and **JSON**. 

### **Step 3: Provide Test Data**
Paste this JSON into the body:
```json
{
  "name": "Test User",
  "email": "test@example.com",
  "password": "password123"
}
```

### **Step 4: Analyze the Response**
- **Success (201 Created):** You should see your user object (without the password!) and a `success: true` flag.
- **Check Cookies:** Look at the "Cookies" tab in Postman. You should see a cookie named `token`. This is your user's "Passport."

### **Step 5: Test Errors (The "Waterfall")**
1.  **Duplicate Email:** Click "Send" again with the same email. You should get a **409 Conflict** error.
2.  **Bad Data:** Change the email to `"not-an-email"` and click "Send." You should get a **400 Bad Request** validation error.

---

### Study Tip:
Open your **Prisma Studio** (`npx prisma studio`) while you test. You can watch the new user appear in your actual PostgreSQL database in real-time! 
