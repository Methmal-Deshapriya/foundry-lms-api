# Audit Logging & Accountability: Deep-Dive & Implementation Guide

This document provides a comprehensive overview of the **Audit Logs Module** in the **Foundry LMS Backend**. It serves as a study guide for understanding background tasks, dynamic filtering, and system-wide accountability.

---

## 1. The "Fire and Forget" Architecture

The Audit module is designed to be a high-performance "Security Camera." It uses a pattern called **Detached Execution**.

1.  **Non-Blocking Logic:** The `recordActionService` function is triggered by other services but is **never awaited**. 
2.  **Internal Error Handling:** Because it is detached, it handles its own errors (logging them to the server console) so that if the audit database is busy, the user's main action (like deleting a bootcamp) still succeeds.
3.  **The Result:** High performance and 100% reliability for the end-user.

---

## 2. The History Search Engine

We implemented a professional data-retrieval pattern in the Repository and Service:

### **A. Dynamic Query Building**
- **The Concept:** The repository builds the SQL `WHERE` clause on the fly.
- **The Filters:**
    - `action`: Specific events (e.g., `USER_PROMOTED`).
    - `resourceType`: Categories (e.g., `BOOTCAMP`).
    - `actorUserId`: Who did it.
    - `from/to`: Date ranges for time-based tracking.

### **B. findAndCount Pattern**
- **The Problem:** Pagination needs two answers: "Give me the data" and "How many are there total?"
- **The Solution:** We use `prisma.$transaction`. This runs both queries in one atomic step, ensuring the "Total Count" matches the "Data" perfectly.

### **C. Professional Pagination Metadata**
Instead of just a list, the API returns a `pagination` object:
- `total`: Total records in the database.
- `hasMore`: A boolean hint for the frontend to show a "Load More" button.

---

## 3. Integration Plan (The "Wiring")

Now that the module is complete, we plan to "wire" it into the other modules. The flow works like this:

1.  **The Trigger:** A state-changing action succeeds (e.g., `promoteUserService`).
2.  **The Context:** The Controller passes the `actorUserId` (the logged-in admin) to the Service.
3.  **The Record:** The Service calls `recordActionService()` with the details.
4.  **The Result:** A permanent, unchangeable record is created in the background.

---

## 4. Testing the Module (Standalone)

Before we integrate, you can test the "History Viewer" functionality.

### **Step 1: Manually Create a Log (for testing)**
Since we haven't "wired" it yet, use **Prisma Studio** (`npx prisma studio`) to manually add 2-3 rows to the `audit_logs` table.
- Set `actorUserId` to your Super Admin ID.
- Set `action` to `USER_PROMOTED`.
- Set `entityType` to `USER`.

### **Step 2: Fetch History**
1. **Login** as a `SUPER_ADMIN`.
2. **Method:** GET
3. **URL:** `http://localhost:5000/api/v1/audit/logs`
4. **Expect:** `200 OK` with your manual logs and pagination metadata.

### **Step 3: Test Filtering**
1. **URL:** `http://localhost:5000/api/v1/audit/logs?action=USER_PROMOTED`
2. **Expect:** Only logs with that specific action.

### **Step 4: Test Pagination**
1. **URL:** `http://localhost:5000/api/v1/audit/logs?limit=1&offset=0`
2. **Expect:** Only the first log and `hasMore: true`.

---

### Study Tip:
Look at the `audit.repository.js` file. Notice how we use `new Date(filters.from)` to convert the URL string into a JavaScript Date object. This is a critical step before sending data to Prisma!
