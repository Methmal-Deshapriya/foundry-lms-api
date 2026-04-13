# Bootcamp Management: Deep-Dive & Implementation Guide

This document provides a comprehensive overview of the **Bootcamps Module** in the **Foundry LMS Backend**. It serves as a study guide for understanding product lifecycle management and advanced routing.

---

## 1. The Dual-Sided Architecture

The Bootcamp module is unique because it serves two different audiences through the same "Sign on the Door" (Routes):

1.  **Public Marketplace (`/v1/bootcamps`)**: 
    - **No Auth Required.**
    - Only returns courses where `isPublished: true`.
    - Uses **Slugs** for user-friendly URLs.
    - Uses `toPublicBootcampResponse` to hide management metadata.

2.  **Admin Dashboard (`/v1/bootcamps/admin`)**:
    - **Requires ADMIN or SUPER_ADMIN role.**
    - Returns ALL courses (Drafts + Published).
    - Uses **UUIDs** for precise targeting.
    - Uses `toAdminBootcampResponse` to show all technical fields.

---

## 2. Technical Key Concepts

### **A. Static vs. Dynamic Routes**
- **The Rule:** In Express, `router.get("/admin", ...)` must come **BEFORE** `router.get("/:slug", ...)`.
- **Why?** Express matches routes from top to bottom. If the slug route was first, a request to `/admin` would be caught by the slug route (Express would think "admin" is the slug).

### **B. Slug Validation (Regex)**
- **The Logic:** We use Zod to enforce a strict pattern: `/^[a-z0-9-]+$/`.
- **The Benefit:** This ensures your URLs are always "Web Safe." No spaces, emojis, or weird characters that could break a browser or hurt your SEO.

### **C. The Visibility Guard**
- **In Service:** `getBootcampBySlugService` doesn't just find the course; it checks if it's published.
- **Why?** Even if someone "guesses" the URL of a draft course, the service will throw a `404 Not Found`. This is a crucial security layer for hidden content.

---

## 3. Testing the Module (Postman Instructions)

Follow this sequence to verify the entire lifecycle of a bootcamp.

### **Step 1: Create a Draft Course**
1. **Login** as a `SUPER_ADMIN`.
2. **Method:** POST
3. **URL:** `http://localhost:5000/api/v1/bootcamps`
4. **Body (JSON):**
```json
{
  "title": "Mastering Node.js",
  "slug": "mastering-node-js",
  "description": "The ultimate backend course.",
  "price": 49.99
}
```
5. **Expect:** `201 Created`. Note the `id` from the response.

### **Step 2: Verify it's Hidden from Public**
1. **Method:** GET
2. **URL:** `http://localhost:5000/api/v1/bootcamps`
3. **Expect:** The list should be empty (or not contain your new course).

### **Step 3: Admin View (The Dashboard)**
1. **Method:** GET
2. **URL:** `http://localhost:5000/api/v1/bootcamps/admin`
3. **Expect:** You should see your new course with `isPublished: false`.

### **Step 4: Publish the Course**
1. Take the `id` from Step 1.
2. **Method:** PATCH
3. **URL:** `http://localhost:5000/api/v1/bootcamps/{ID}/publish`
4. **Expect:** Success message and `isPublished: true`.

### **Step 5: Public Marketplace Check**
1. **Method:** GET
2. **URL:** `http://localhost:5000/api/v1/bootcamps`
3. **Expect:** The course is now live!

### **Step 6: Public Detail Check**
1. **Method:** GET
2. **URL:** `http://localhost:5000/api/v1/bootcamps/mastering-node-js`
3. **Expect:** Full details of the course (sanitized for public view).

---

### Study Tip:
Try to create two courses with the **same slug**. Watch how our `handlePrismaError` foundation automatically sends back a professional **409 Conflict** error because of the Unique constraint in `schema.prisma`.
