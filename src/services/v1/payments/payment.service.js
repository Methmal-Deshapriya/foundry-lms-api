import { paymentBalance } from "../../../utils/paymentBalance.js";
import { colomboYear } from "../../../utils/colomboTime.js";
import * as repository from "../../../repositories/v1/payments/payment.repository.js";
import {
  monthlySummaryQuerySchema,
  paymentLedgerFiltersSchema,
  refundPaymentSchema,
  reversePaymentSchema,
  updatePaymentDetailsSchema,
} from "../../../constants/v1/payments/payment.schema.js";
import { AUDIT_ACTIONS, ENTITY_TYPES } from "../../../constants/v1/audit/audit.constants.js";
import { NotFoundError, ValidationError } from "../../../utils/Errors.js";
import Logger from "../../../utils/logger.js";
import { recordActionService } from "../audit/audit.service.js";
import { assertAttachableStoredObject, deleteStoredObjectService, privateStoredObjectUrl } from "../storage/storedObject.service.js";

/**
 * Payment Ledger Service — super admins only (PAYMENTS_VIEW / _MANAGE).
 * See the 2026-10-01 next-features plan §4. The system never takes money;
 * it records what an admin confirms already happened.
 */

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new ValidationError(issue?.message ?? "Validation failed.", issue?.path?.[0]);
  }
  return result.data;
}

const toNumber = (value) => Number(value ?? 0);

/**
 * FA-<year it was recorded, Sri Lanka time>-<6-digit sequence>, e.g.
 * FA-2026-000123. From createdAt, which never changes: correcting "Date
 * received" later must not renumber a receipt already handed to a student
 * (code review M03-11/M03-12).
 */
export function receiptNumber(payment) {
  const year = colomboYear(payment.createdAt ?? payment.paidAt);
  return `FA-${year}-${String(payment.receiptSequence).padStart(6, "0")}`;
}

function toEntrySummary(payment) {
  return {
    id: payment.id,
    type: payment.type,
    amount: toNumber(payment.amount),
    receiptNumber: receiptNumber(payment),
    paidAt: payment.paidAt,
    ...(payment.note !== undefined ? { note: payment.note } : {}),
  };
}

function toLedgerEntry(payment) {
  const student = payment.enrollment?.user;
  return {
    id: payment.id,
    receiptNumber: receiptNumber(payment),
    type: payment.type,
    method: payment.method,
    amount: toNumber(payment.amount),
    discountAmount: toNumber(payment.discountAmount),
    currency: payment.currency,
    paidAt: payment.paidAt,
    recordedAt: payment.createdAt,
    externalReference: payment.externalReference,
    note: payment.note,
    recordedBy: payment.recordedBy ? `${payment.recordedBy.firstName} ${payment.recordedBy.lastName}`.trim() : null,
    student: student ? { id: student.id, name: `${student.firstName} ${student.lastName}`.trim(), email: student.email, phone: student.phone } : null,
    enrollment: { id: payment.enrollment?.id, status: payment.enrollment?.status, paymentStatus: payment.enrollment?.paymentStatus },
    course: { id: payment.course.id, title: payment.course.title, price: toNumber(payment.course.price), service: payment.course.service },
    intake: payment.intake,
    hasProof: Boolean(payment.proofObjectId),
    corrects: payment.corrects ? toEntrySummary(payment.corrects) : null,
    corrections: (payment.corrections ?? []).map(toEntrySummary),
  };
}

function summarize(byType) {
  const sum = (types) => byType.filter((row) => types.includes(row.type)).reduce((total, row) => total + toNumber(row._sum.amount), 0);
  const collected = sum(["FULL", "PARTIAL", "TOP_UP"]);
  const refunded = -sum(["REFUND"]);
  const reversed = -sum(["REVERSAL"]);
  const countByType = Object.fromEntries(["FULL", "PARTIAL", "TOP_UP", "REFUND", "REVERSAL"].map((type) => [type, byType.find((row) => row.type === type)?._count ?? 0]));
  const all = Object.values(countByType).reduce((total, count) => total + count, 0);
  return { collected, refunded, reversed, net: collected - refunded - reversed, counts: { all, ...countByType } };
}

export async function getLedgerService(query) {
  const filters = parse(paymentLedgerFiltersSchema, query);
  const wantsSummary = filters.summary !== "false";
  const [{ total, byType, entries }, outstanding] = await Promise.all([
    repository.findLedgerPage(filters),
    wantsSummary ? getOutstandingTotal() : null,
  ]);
  return {
    entries: entries.map(toLedgerEntry),
    summary: wantsSummary ? { ...summarize(byType), outstanding } : null,
    pagination: { total, limit: filters.limit, offset: filters.offset, hasMore: filters.offset + entries.length < total },
  };
}

export async function getPaymentService(id, { includeProofUrl = true } = {}) {
  const payment = await repository.findById(id);
  if (!payment) throw new NotFoundError("Payment not found.");
  const entry = toLedgerEntry(payment);
  return {
    ...entry,
    proof: payment.proofObject
      ? {
          id: payment.proofObject.id,
          fileName: payment.proofObject.originalFileName,
          contentType: payment.proofObject.contentType,
          sizeBytes: Number(payment.proofObject.actualSizeBytes ?? payment.proofObject.declaredSizeBytes),
          // Presigned and short-lived — proofs are private financial records.
          url: includeProofUrl ? await privateStoredObjectUrl(payment.proofObject) : null,
        }
      : null,
  };
}

async function loadOutstanding() {
  const rows = await repository.findOutstanding();
  return rows
    .map((enrollment) => {
      const { agreed, netPaid: paid, owed } = paymentBalance(enrollment);
      return {
        enrollmentId: enrollment.id,
        enrolledAt: enrollment.createdAt,
        daysOutstanding: Math.floor((Date.now() - new Date(enrollment.createdAt).getTime()) / 86_400_000),
        student: {
          id: enrollment.user.id,
          name: `${enrollment.user.firstName} ${enrollment.user.lastName}`.trim(),
          email: enrollment.user.email,
          phone: enrollment.user.phone,
        },
        course: { id: enrollment.course.id, title: enrollment.course.title, serviceSlug: enrollment.course.service?.slug ?? null },
        intake: enrollment.intake,
        currency: enrollment.course.currency,
        price: toNumber(agreed),
        paid: toNumber(paid),
        owed: toNumber(owed),
      };
    })
    .filter((row) => row.owed > 0);
}

async function getOutstandingTotal() {
  return (await loadOutstanding()).reduce((total, row) => total + row.owed, 0);
}

export async function getOutstandingService() {
  const rows = await loadOutstanding();
  return { rows, total: rows.reduce((sum, row) => sum + row.owed, 0) };
}

export async function getMonthlySummaryService(query) {
  const { year } = parse(monthlySummaryQuerySchema, query);
  const rows = await repository.findMonthlyTotals(year);
  const byMonth = new Map(rows.map((row) => [row.month, row]));
  const months = Array.from({ length: 12 }, (_, index) => {
    const row = byMonth.get(index + 1);
    return {
      month: index + 1,
      collected: toNumber(row?.collected),
      refunded: toNumber(row?.refunded),
      reversed: toNumber(row?.reversed),
      net: toNumber(row?.net),
      entries: row?.entries ?? 0,
    };
  });
  const totals = months.reduce(
    (sum, month) => ({
      collected: sum.collected + month.collected,
      refunded: sum.refunded + month.refunded,
      reversed: sum.reversed + month.reversed,
      net: sum.net + month.net,
      entries: sum.entries + month.entries,
    }),
    { collected: 0, refunded: 0, reversed: 0, net: 0, entries: 0 },
  );
  return { year, months, totals };
}

export async function refundPaymentService(id, data, actorId) {
  const input = parse(refundPaymentSchema, data);
  const refundId = await repository.createRefund(id, actorId, input);
  const refund = await getPaymentService(refundId, { includeProofUrl: false });
  recordActionService({
    actorUserId: actorId,
    action: AUDIT_ACTIONS.PAYMENT_REFUNDED,
    entityType: ENTITY_TYPES.PAYMENT,
    entityId: refundId,
    description: `Refunded ${input.amount} ${refund.currency} of ${refund.corrects?.receiptNumber ?? id} to ${refund.student?.email ?? "a student"}: ${input.reason}`,
    metadata: { paymentId: id, amount: input.amount, method: input.method ?? null },
  });
  return refund;
}

export async function reversePaymentService(id, data, actorId) {
  const input = parse(reversePaymentSchema, data);
  const reversalId = await repository.createReversal(id, actorId, input);
  const reversal = await getPaymentService(reversalId, { includeProofUrl: false });
  recordActionService({
    actorUserId: actorId,
    action: AUDIT_ACTIONS.PAYMENT_REVERSED,
    entityType: ENTITY_TYPES.PAYMENT,
    entityId: reversalId,
    description: `Reversed ${reversal.corrects?.receiptNumber ?? id} (${reversal.student?.email ?? "a student"}): ${input.reason}`,
    metadata: { paymentId: id },
  });
  return reversal;
}

export async function updatePaymentDetailsService(id, data, actorId) {
  const input = parse(updatePaymentDetailsSchema, data);
  const current = await repository.findById(id);
  if (!current) throw new NotFoundError("Payment not found.");

  const proofChanged = input.proofObjectId !== undefined && input.proofObjectId !== current.proofObjectId;
  if (proofChanged && input.proofObjectId) await assertAttachableStoredObject(input.proofObjectId, "PAYMENT_PROOF");

  await repository.updateDetails(id, {
    ...(input.method !== undefined ? { method: input.method } : {}),
    ...(input.paidAt !== undefined ? { paidAt: new Date(input.paidAt) } : {}),
    ...(input.externalReference !== undefined ? { externalReference: input.externalReference || null } : {}),
    ...(proofChanged ? { proofObjectId: input.proofObjectId } : {}),
  });

  // One proof file per payment: a replaced or removed proof is deleted from
  // storage. Best-effort — never undoes the successful save.
  if (proofChanged && current.proofObject) {
    deleteStoredObjectService(current.proofObject, actorId).catch((error) =>
      Logger.error(`[PROOF_CLEANUP_FAILED]: Could not delete replaced payment proof ${current.proofObject.id}`, error),
    );
  }

  recordActionService({
    actorUserId: actorId,
    action: AUDIT_ACTIONS.PAYMENT_DETAILS_UPDATED,
    entityType: ENTITY_TYPES.PAYMENT,
    entityId: id,
    description: `Updated details of payment ${receiptNumber(current)}.`,
    // Before → after for every descriptive field changed, so a corrected
    // date or reference can always be traced (code review M03-11).
    metadata: {
      changedFields: Object.keys(input),
      changes: Object.fromEntries(
        ["method", "paidAt", "externalReference", "proofObjectId"]
          .filter((field) => input[field] !== undefined)
          .map((field) => [field, { from: current[field] ?? null, to: field === "paidAt" ? new Date(input.paidAt) : input[field] ?? null }]),
      ),
    },
  });
  return getPaymentService(id);
}
