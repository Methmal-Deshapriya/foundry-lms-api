// Whether an enrollment currently qualifies for "learning access" — reading
// classroom content, marking sessions complete, submitting a project. This
// is intentionally shared by every call site that needs it (rather than
// each one re-deriving its own copy) so a future policy change — like a
// PARTIAL payment starting to count as "paid enough" — only has to happen
// once. Certificate issuance is NOT one of those call sites: it enforces
// its own stricter, COMPLETED-only rule directly in
// certificate.repository.js, since that's a genuinely different policy.

/**
 * @param {"NOT_REQUIRED"|"PARTIAL"|"COMPLETED"} paymentStatus
 */
export function hasSufficientPayment(paymentStatus) {
  return paymentStatus === "COMPLETED" || paymentStatus === "PARTIAL";
}

/**
 * @param {{ source: "ADMIN"|"SELF", paymentStatus: "NOT_REQUIRED"|"PARTIAL"|"COMPLETED" }} enrollment
 * @param {{ accessType: "FREE"|"PAID", enrollmentMode: "SELF"|"ADMIN", paymentRequirement: "REQUIRED"|"NOT_REQUIRED" }} policy - the enrollment's course's category's service
 */
export function hasLearningAccess(enrollment, policy) {
  return policy.accessType === "FREE"
    ? policy.enrollmentMode === "SELF" &&
        policy.paymentRequirement === "NOT_REQUIRED" &&
        enrollment.source === "SELF" &&
        enrollment.paymentStatus === "NOT_REQUIRED"
    : policy.enrollmentMode === "ADMIN" &&
        policy.paymentRequirement === "REQUIRED" &&
        enrollment.source === "ADMIN" &&
        hasSufficientPayment(enrollment.paymentStatus);
}
