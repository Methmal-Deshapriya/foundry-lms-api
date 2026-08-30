/**
 * Enrollment Module Constants
 */

export const ENROLLMENT_STATUS = {
  ACTIVE: "ACTIVE",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
};

export const PAYMENT_STATUS = {
  NOT_REQUIRED: "NOT_REQUIRED",
  PARTIAL: "PARTIAL",
  COMPLETED: "COMPLETED",
};

// A paid enrollment is only ever recorded after the money has already
// changed hands outside the system — there is no "reserve a seat, pay
// later" state to track here.
export const PAYMENT_TYPE = {
  FULL: "FULL", // paid the full (discounted) price in one go at enrollment time
  PARTIAL: "PARTIAL", // paid half the full price at enrollment time
  TOP_UP: "TOP_UP", // paid the remaining half after being enrolled as PARTIAL
};

export const CERTIFICATE_STATUS = {
  ISSUED: "ISSUED",
  REVOKED: "REVOKED",
};

export const ALL_ENROLLMENT_STATUSES = Object.values(ENROLLMENT_STATUS);
export const ALL_PAYMENT_STATUSES = Object.values(PAYMENT_STATUS);
export const ALL_PAYMENT_TYPES = Object.values(PAYMENT_TYPE);
export const ALL_CERTIFICATE_STATUSES = Object.values(CERTIFICATE_STATUS);

export const ENROLLMENT_STATUS_TRANSITIONS = Object.freeze({
  [ENROLLMENT_STATUS.ACTIVE]: Object.freeze([
    ENROLLMENT_STATUS.COMPLETED,
    ENROLLMENT_STATUS.CANCELLED,
  ]),
  [ENROLLMENT_STATUS.COMPLETED]: Object.freeze([]),
  [ENROLLMENT_STATUS.CANCELLED]: Object.freeze([
    ENROLLMENT_STATUS.ACTIVE,
  ]),
});
