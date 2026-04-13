# Audit Wiring Blueprint: System-Wide Accountability

This document serves as the master plan for integrating the **Audit Logs Module** with other business modules. It defines exactly which actions are recorded, who triggers them, and what metadata is preserved.

---

## 1. Guiding Principles for Wiring

1.  **Non-Blocking (Performance):** Audit logs are "Fire and Forget." We never `await` an audit write inside a business service.
2.  **Success-Only:** Actions are only recorded *after* the primary database operation succeeds.
3.  **Context Propagation:** The `actorUserId` (Admin ID) must be passed from the Controller to the Service to ensure accountability.
4.  **Privacy:** No sensitive data (passwords, tokens) is ever stored in the `metadata` JSON.

---

## 2. Target Wiring Points (V1 Scope)

### **Module 03: Users (Administrative Actions)**

| Action | Entity | Trigger Point | Metadata Captured |
| :--- | :--- | :--- | :--- |
| **USER_PROMOTED** | USER | `promoteUserService` | `{ oldRole, newRole }` |
| **USER_DEMOTED** | USER | `demoteUserService` | `{ oldRole, newRole }` |

### **Module 04: Bootcamps (Content Management)**

| Action | Entity | Trigger Point | Metadata Captured |
| :--- | :--- | :--- | :--- |
| **BOOTCAMP_CREATED** | BOOTCAMP | `createBootcampService` | `{ title, slug, price }` |
| **BOOTCAMP_UPDATED** | BOOTCAMP | `updateBootcampService` | `{ changedFields }` |
| **BOOTCAMP_DELETED** | BOOTCAMP | `deleteBootcampService` | `{ title, slug }` |
| **BOOTCAMP_PUBLISHED** | BOOTCAMP | `togglePublishService` | `{ state: true }` |
| **BOOTCAMP_UNPUBLISHED**| BOOTCAMP | `togglePublishService` | `{ state: false }` |

### **Module 05: Enrollments (Access Control)**

| Action | Entity | Trigger Point | Metadata Captured |
| :--- | :--- | :--- | :--- |
| **STUDENT_ENROLLED** | ENROLLMENT | `enrollStudentService` | `{ studentId, bootcampId }` |

---

## 3. The Implementation Pattern (Standardized)

To ensure consistency and prevent performance degradation, every "Wire" must follow this pattern:

### **Step A: The Controller Update**
Pass the `req.user.id` (the actor) to the service function.
```javascript
const result = await someService.someAction(data, req.user.id);
```

### **Step B: The Service Trigger**
Import the audit service and constants, then trigger the record *without* `await`.
```javascript
const record = await repo.save(data); // Primary action (awaited)

// Audit Log (Fire and Forget - NOT awaited)
recordActionService({
  actorUserId: actorId,
  action: AUDIT_ACTIONS.SOME_ACTION,
  entityType: ENTITY_TYPES.SOME_ENTITY,
  entityId: record.id,
  description: `User ${actorId} did something to ${record.id}`,
  metadata: { ... }
});

return record;
```

---

## 4. Safety & Performance Checklist

- [ ] Does the Service import `recordActionService`?
- [ ] Does the Controller pass the `actorUserId`?
- [ ] Is the audit call **NOT** awaited?
- [ ] Is the audit call placed **AFTER** the database success?
- [ ] Is there a `.catch()` or internal error handling in the audit service? (Confirmed in Foundation).
- [ ] Are secrets excluded from metadata?

---

**Approval Status:**
*This document is awaiting review by the lead engineer.*
