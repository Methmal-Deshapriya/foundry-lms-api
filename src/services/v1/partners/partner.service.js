import * as repository from "../../../repositories/v1/partners/partner.repository.js";
import { endOfColomboDay, startOfColomboDay } from "../../../utils/colomboTime.js";
import {
  createExpenseSchema,
  createPayoutSchema,
  createShareSetSchema,
  expenseFiltersSchema,
  payoutFiltersSchema,
  rangeQuerySchema,
  reverseEntrySchema,
} from "../../../constants/v1/partners/partner.schema.js";
import { AUDIT_ACTIONS, ENTITY_TYPES } from "../../../constants/v1/audit/audit.constants.js";
import { ConflictError, NotFoundError, ValidationError } from "../../../utils/Errors.js";
import { recordActionService } from "../audit/audit.service.js";
import { assertAttachableStoredObject, privateStoredObjectUrl } from "../storage/storedObject.service.js";
import { computeByIntake, computeOverview } from "./partnerEarnings.calc.js";

/**
 * Partner earnings — super admins only (PAYMENTS_VIEW / PAYMENTS_MANAGE).
 * See foundry_lms_docs/2026-10-01_partner_earnings_implementation_plan.md.
 */

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new ValidationError(issue?.message ?? "Validation failed.", issue?.path?.[0]);
  }
  return result.data;
}

const name = (user) => (user ? `${user.firstName} ${user.lastName}`.trim() : null);

async function loadBase() {
  const [partners, shareSets] = await Promise.all([repository.findPartnersForEarnings(), repository.findShareSets()]);
  return {
    partners: partners.map((partner) => ({ id: partner.id, name: partner.name, displayOrder: partner.displayOrder })),
    shareSets: shareSets.map((set) => ({ effectiveFrom: set.effectiveFrom, entries: set.entries.map((entry) => ({ partnerId: entry.partnerId, percent: Number(entry.percent) })) })),
  };
}

// ---------------------------------------------------------------- reports

export async function getOverviewService(query) {
  const range = parse(rangeQuerySchema, query);
  const [base, payments, expenses, payouts] = await Promise.all([
    loadBase(),
    repository.findPaymentsForEarnings(range),
    repository.findExpensesForEarnings(range),
    repository.findPayoutsForEarnings(range),
  ]);
  return { range, ...computeOverview({ ...base, payments, expenses, payouts }) };
}

export async function getByIntakeService(query) {
  const range = parse(rangeQuerySchema, query);
  const [base, payments, expenses] = await Promise.all([loadBase(), repository.findPaymentsForEarnings(range), repository.findExpensesForEarnings(range)]);
  const intakeIds = [...new Set([...payments, ...expenses].map((row) => row.intakeId).filter(Boolean))];
  const labels = await repository.findIntakeLabels(intakeIds);
  const intakes = new Map(labels.map((intake) => [intake.id, { intakeCode: intake.code, courseTitle: intake.course.title }]));
  return { range, partners: base.partners, rows: computeByIntake({ ...base, payments, expenses, intakes }) };
}

// --------------------------------------------------------------- partners & shares

export async function getSharesService() {
  const [partners, sets] = await Promise.all([repository.findPartners(), repository.findShareSets()]);
  return {
    partners: partners.map((partner) => ({ id: partner.id, name: partner.name, displayOrder: partner.displayOrder })),
    shareSets: sets
      .map((set) => ({
        id: set.id,
        effectiveFrom: set.effectiveFrom,
        note: set.note,
        createdBy: name(set.createdBy),
        createdAt: set.createdAt,
        entries: set.entries
          .sort((a, b) => a.partner.displayOrder - b.partner.displayOrder)
          .map((entry) => ({ partnerId: entry.partnerId, name: entry.partner.name, percent: Number(entry.percent) })),
      }))
      .reverse(),
  };
}

export async function createShareSetService(data, actorId) {
  const input = parse(createShareSetSchema, data);
  const [partners, sets] = await Promise.all([repository.findPartners(), repository.findShareSets()]);
  const partnerIds = new Set(partners.map((partner) => partner.id));
  if (input.entries.length !== partnerIds.size || input.entries.some((entry) => !partnerIds.has(entry.partnerId))) {
    throw new ValidationError("Give every partner a share (use 0% to leave someone out).", "entries");
  }
  // History is never rewritten: a new split starts at 00:00 Sri Lanka time
  // on a day after today, so nothing already recorded (or paid out against)
  // changes split (code review M03-05).
  const effectiveFrom = startOfColomboDay(new Date(input.effectiveFrom));
  if (effectiveFrom <= endOfColomboDay()) {
    throw new ConflictError("A new split must start tomorrow or later — past figures never change.", "SHARE_SET_BACKDATED");
  }
  const latest = sets.at(-1);
  if (latest && effectiveFrom <= new Date(latest.effectiveFrom)) {
    throw new ConflictError("A new split must start after the latest one.", "SHARE_SET_BACKDATED");
  }
  const { id } = await repository.createShareSet({ ...input, effectiveFrom, createdByUserId: actorId });
  recordActionService({
    actorUserId: actorId,
    action: AUDIT_ACTIONS.SHARE_SET_CREATED,
    entityType: ENTITY_TYPES.SHARE_SET,
    entityId: id,
    description: `New partner split from ${input.effectiveFrom.slice(0, 10)}.`,
    metadata: { entries: input.entries },
  });
  return getSharesService();
}

// ---------------------------------------------------------------- expenses

function toExpense(row) {
  return {
    id: row.id,
    spentAt: row.spentAt,
    amount: Number(row.amount),
    currency: row.currency,
    category: row.category,
    description: row.description,
    intake: row.intake ? { id: row.intake.id, code: row.intake.code, courseTitle: row.intake.course.title } : null,
    paidBy: row.paidBy ? { id: row.paidBy.id, name: row.paidBy.name } : null,
    kind: row.kind,
    reversed: row.corrections.length > 0,
    corrects: row.corrects ? { id: row.corrects.id, amount: Number(row.corrects.amount), category: row.corrects.category, spentAt: row.corrects.spentAt } : null,
    hasReceipt: Boolean(row.receiptObjectId),
    recordedBy: name(row.recordedBy),
    recordedAt: row.createdAt,
  };
}

export async function listExpensesService(query) {
  const filters = parse(expenseFiltersSchema, query);
  const { total, sum, rows } = await repository.findExpensesPage(filters);
  return {
    expenses: rows.map(toExpense),
    sum,
    pagination: { total, limit: filters.limit, offset: filters.offset, hasMore: filters.offset + rows.length < total },
  };
}

export async function getExpenseService(id) {
  const row = await repository.findExpenseById(id);
  if (!row) throw new NotFoundError("Expense not found.");
  return {
    ...toExpense(row),
    receipt: row.receiptObject
      ? { fileName: row.receiptObject.originalFileName, contentType: row.receiptObject.contentType, url: await privateStoredObjectUrl(row.receiptObject) }
      : null,
  };
}

export async function createExpenseService(data, actorId) {
  const input = parse(createExpenseSchema, data);
  if (input.receiptObjectId) await assertAttachableStoredObject(input.receiptObjectId, "EXPENSE_RECEIPT");
  if (input.paidByPartnerId) {
    const partners = await repository.findPartners();
    if (!partners.some((partner) => partner.id === input.paidByPartnerId)) throw new ValidationError("Choose who paid.", "paidByPartnerId");
  }
  const { id } = await repository.createExpense({
    spentAt: new Date(input.spentAt),
    amount: input.amount,
    category: input.category,
    description: input.description ?? null,
    intakeId: input.intakeId ?? null,
    paidByPartnerId: input.paidByPartnerId ?? null,
    receiptObjectId: input.receiptObjectId ?? null,
    recordedByUserId: actorId,
  });
  recordActionService({
    actorUserId: actorId,
    action: AUDIT_ACTIONS.EXPENSE_RECORDED,
    entityType: ENTITY_TYPES.EXPENSE,
    entityId: id,
    description: `Recorded a ${input.category.toLowerCase().replaceAll("_", " ")} expense of LKR ${input.amount}.`,
  });
  return getExpenseService(id);
}

export async function reverseExpenseService(id, data, actorId) {
  const { reason } = parse(reverseEntrySchema, data);
  const reversalId = await repository.reverseExpense(id, actorId, reason);
  recordActionService({
    actorUserId: actorId,
    action: AUDIT_ACTIONS.EXPENSE_REVERSED,
    entityType: ENTITY_TYPES.EXPENSE,
    entityId: reversalId,
    description: `Reversed an expense: ${reason}`,
    metadata: { expenseId: id },
  });
  return getExpenseService(reversalId);
}

// ----------------------------------------------------------------- payouts

function toPayout(row) {
  return {
    id: row.id,
    partner: row.partner,
    amount: Number(row.amount),
    currency: row.currency,
    paidAt: row.paidAt,
    method: row.method,
    reference: row.reference,
    note: row.note,
    kind: row.kind,
    reversed: row.corrections.length > 0,
    corrects: row.corrects ? { id: row.corrects.id, amount: Number(row.corrects.amount), paidAt: row.corrects.paidAt } : null,
    recordedBy: name(row.recordedBy),
    recordedAt: row.createdAt,
  };
}

export async function listPayoutsService(query) {
  const filters = parse(payoutFiltersSchema, query);
  const { total, rows } = await repository.findPayoutsPage(filters);
  return { payouts: rows.map(toPayout), pagination: { total, limit: filters.limit, offset: filters.offset, hasMore: filters.offset + rows.length < total } };
}

export async function createPayoutService(data, actorId) {
  const input = parse(createPayoutSchema, data);
  const partners = await repository.findPartners();
  const partner = partners.find((item) => item.id === input.partnerId);
  if (!partner) throw new ValidationError("Choose the partner.", "partnerId");
  const { id } = await repository.createPayout({
    partnerId: input.partnerId,
    amount: input.amount,
    paidAt: new Date(input.paidAt),
    method: input.method ?? null,
    reference: input.reference || null,
    note: input.note || null,
    recordedByUserId: actorId,
  });
  recordActionService({
    actorUserId: actorId,
    action: AUDIT_ACTIONS.PAYOUT_RECORDED,
    entityType: ENTITY_TYPES.PAYOUT,
    entityId: id,
    description: `Recorded a payout of LKR ${input.amount} to ${partner.name}.`,
  });
  return { id };
}

export async function reversePayoutService(id, data, actorId) {
  const { reason } = parse(reverseEntrySchema, data);
  const reversalId = await repository.reversePayout(id, actorId, reason);
  recordActionService({
    actorUserId: actorId,
    action: AUDIT_ACTIONS.PAYOUT_REVERSED,
    entityType: ENTITY_TYPES.PAYOUT,
    entityId: reversalId,
    description: `Reversed a payout: ${reason}`,
    metadata: { payoutId: id },
  });
  return { id: reversalId };
}
