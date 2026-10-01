import * as repository from "../../../repositories/v1/notifications/notification.repository.js";
import {
  audienceQuerySchema,
  notificationAdminFiltersSchema,
  promotionAdminFiltersSchema,
  publishNotificationSchema,
  saveNotificationSchema,
  savePromotionSchema,
} from "../../../constants/v1/notifications/notification.schema.js";
import { AUDIT_ACTIONS, ENTITY_TYPES } from "../../../constants/v1/audit/audit.constants.js";
import { isLearnerRole } from "../../../constants/v1/auth/permissions.constants.js";
import { paymentBalance } from "../../../utils/paymentBalance.js";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../../utils/Errors.js";
import { getEmailUsage, releaseEmailQuota, reserveEmailQuota, sendPaymentReminderEmail } from "../../../utils/email.js";
import { publicObjectUrl } from "../../../config/r2.js";
import Logger from "../../../utils/logger.js";
import { recordActionService } from "../audit/audit.service.js";
import { assertAttachableStoredObject, deleteStoredObjectService } from "../storage/storedObject.service.js";

/**
 * Notifications (in-app, for students) and Promotions (the public landing
 * banner). Phase 3 of the 2026-10-01 next-features plan.
 */

// Always left unused by bulk notification email, so a big send can never
// block sign-in codes and password resets for the rest of the day — and,
// for every day left in the month, of the month (code review M09-06).
export const EMAIL_RESERVE = 20;

// Pause between reminder emails: Resend rate-limits bursts (M09-02).
const EMAIL_SEND_INTERVAL_MS = Number(process.env.NOTIFICATION_EMAIL_INTERVAL_MS ?? 400);
const RATE_LIMIT_RETRY_MS = 1500;
const sleep = (ms) => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve());

/** Days left in the UTC month, today included. */
function daysLeftInMonth(now = new Date()) {
  const lastDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  return lastDay - now.getUTCDate() + 1;
}

/** How many emails notifications may still use, keeping the reserves. */
export function notificationEmailRoom(usage, now = new Date()) {
  const daily = usage.dailyLimit - usage.sentToday - EMAIL_RESERVE;
  const monthly = usage.monthlyLimit - usage.sentThisMonth - EMAIL_RESERVE * daysLeftInMonth(now);
  return Math.max(0, Math.min(daily, monthly));
}

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new ValidationError(issue?.message ?? "Validation failed.", issue?.path?.[0]);
  }
  return result.data;
}

const formatLkr = (amount) => `LKR ${Number(amount).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

// From the enrollment's agreed price and its own ledger (M03-01).
function owed(enrollment) {
  return Number(paymentBalance(enrollment).owed);
}

function isLive(row, now = new Date()) {
  return row.status === "PUBLISHED" && (!row.startsAt || row.startsAt <= now) && (!row.endsAt || row.endsAt >= now);
}

// Only the fields relevant to the chosen audience are kept.
function normalizeTarget(input) {
  return {
    audience: input.audience,
    courseId: ["COURSE", "PARTIAL_PAYERS", "COURSE_INTEREST"].includes(input.audience) ? input.courseId ?? null : null,
    intakeId: ["INTAKE", "PARTIAL_PAYERS"].includes(input.audience) ? input.intakeId ?? null : null,
  };
}

// ============================================================ Notifications — admin

/**
 * Students who would actually get a payment reminder: a PARTIAL enrollment
 * in scope that still owes something — the same rule as delivery, so the
 * reach and the email count match (code review M09-14). One entry per
 * student, with their balances.
 */
async function partialPayerRecipients(target) {
  const enrollments = await repository.findPartialPayers(target);
  const byStudent = new Map();
  for (const enrollment of enrollments) {
    if (!isLearnerRole(enrollment.user.role)) continue;
    const amount = owed(enrollment);
    if (amount <= 0) continue;
    const entry = byStudent.get(enrollment.user.id) ?? { user: enrollment.user, balances: [] };
    entry.balances.push({ courseTitle: enrollment.course.title, owedLabel: formatLkr(amount) });
    byStudent.set(enrollment.user.id, entry);
  }
  return [...byStudent.values()];
}

async function audienceReach(target) {
  if (target.audience === "PARTIAL_PAYERS") return (await partialPayerRecipients(target)).length;
  return repository.countAudience(target);
}

const audienceKey = (row) => `${row.audience}|${row.courseId ?? ""}|${row.intakeId ?? ""}`;

async function toAdminNotification(row, reach) {
  return {
    id: row.id,
    title: row.title,
    message: row.message,
    audience: row.audience,
    course: row.course,
    intake: row.intake,
    linkLabel: row.linkLabel,
    linkUrl: row.linkUrl,
    pinned: row.pinned,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    status: row.status,
    isLive: isLive(row),
    publishedAt: row.publishedAt,
    emailSentCount: row.emailSentCount,
    emailSentAt: row.emailSentAt,
    createdBy: row.createdBy ? `${row.createdBy.firstName} ${row.createdBy.lastName}`.trim() : null,
    // Not worked out for archived rows, which reach nobody (M09-09).
    reach: reach !== undefined ? reach : row.status === "ARCHIVED" ? null : await audienceReach(row),
    readCount: row._count?.receipts ?? 0,
    updatedAt: row.updatedAt,
  };
}

export async function listNotificationsService(query) {
  const filters = parse(notificationAdminFiltersSchema, query);
  const { total, rows, summary } = await repository.findNotificationsPage(filters);
  // One reach query per distinct audience on the page, not one per row,
  // and none for archived rows (code review M09-09).
  const reachByAudience = new Map();
  for (const row of rows) {
    if (row.status !== "ARCHIVED" && !reachByAudience.has(audienceKey(row))) reachByAudience.set(audienceKey(row), audienceReach(row));
  }
  const notifications = await Promise.all(
    rows.map(async (row) => toAdminNotification(row, row.status === "ARCHIVED" ? null : await reachByAudience.get(audienceKey(row)))),
  );
  return {
    notifications,
    summary,
    pagination: { total, limit: filters.limit, offset: filters.offset, hasMore: filters.offset + rows.length < total },
  };
}

export async function getAudienceReachService(query) {
  const target = parse(audienceQuerySchema, query);
  return { reach: await audienceReach(normalizeTarget(target)) };
}

export async function getEmailQuotaService() {
  const usage = await getEmailUsage();
  return { ...usage, reserve: EMAIL_RESERVE, availableForNotifications: notificationEmailRoom(usage) };
}

function notificationData(input) {
  return {
    title: input.title,
    message: input.message,
    ...normalizeTarget(input),
    linkLabel: input.linkUrl ? input.linkLabel ?? null : null,
    linkUrl: input.linkUrl ?? null,
    pinned: input.pinned ?? false,
    startsAt: input.startsAt ? new Date(input.startsAt) : null,
    endsAt: input.endsAt ? new Date(input.endsAt) : null,
  };
}

export async function createNotificationService(data, actorId) {
  const input = parse(saveNotificationSchema, data);
  const { id } = await repository.createNotification({ ...notificationData(input), createdByUserId: actorId });
  return toAdminNotification(await repository.findNotificationById(id));
}

export async function updateNotificationService(id, data) {
  const current = await repository.findNotificationById(id);
  if (!current) throw new NotFoundError("Notification not found.");
  if (current.status === "ARCHIVED") throw new ConflictError("An archived notification can't be edited.", "NOTIFICATION_ARCHIVED");
  const input = parse(saveNotificationSchema, data);
  const next = notificationData(input);
  if (current.status === "PUBLISHED") {
    // Students already have it, and their read/dismiss history belongs to
    // this audience. Moving it to another audience is a new notification
    // (code review M09-04).
    if (audienceKey(next) !== audienceKey(current)) {
      throw new ConflictError(
        "Who sees a published notification can't be changed. Archive it and create a new one for the other audience.",
        "NOTIFICATION_AUDIENCE_LOCKED",
      );
    }
  }
  await repository.updateNotification(id, next);
  // Changed wording counts as new: it shows as unread again.
  if (current.status === "PUBLISHED" && (next.title !== current.title || next.message !== current.message)) {
    await repository.resetReads(id);
  }
  return toAdminNotification(await repository.findNotificationById(id));
}

/** Who a reminder's email would go to, and how many already had it. */
export async function getEmailRecipientsService(id) {
  const current = await repository.findNotificationById(id);
  if (!current) throw new NotFoundError("Notification not found.");
  if (current.audience !== "PARTIAL_PAYERS") return { total: 0, alreadyEmailed: 0, pending: 0 };
  const [recipients, emailed] = await Promise.all([partialPayerRecipients(current), repository.findEmailedUserIds(id)]);
  const emailedSet = new Set(emailed);
  const alreadyEmailed = recipients.filter((recipient) => emailedSet.has(recipient.user.id)).length;
  return { total: recipients.length, alreadyEmailed, pending: recipients.length - alreadyEmailed };
}

async function sendReminder(user, payload) {
  try {
    await sendPaymentReminderEmail(user.email, payload, { preCounted: true });
  } catch (error) {
    if (error?.resendName !== "rate_limit_exceeded") throw error;
    // Rate limited: wait and try once more (code review M09-02).
    await sleep(RATE_LIMIT_RETRY_MS);
    await sendPaymentReminderEmail(user.email, payload, { preCounted: true });
  }
}

/**
 * Email a payment reminder to every partial payer in scope who hasn't had
 * it yet (code review M09-01 / M09-02):
 * - one send at a time per notification (a claim on the row);
 * - the emails are reserved from the quota before any goes out, under a
 *   lock, and what isn't sent is given back;
 * - each student is recorded once emailed, so a crash or a failure never
 *   re-emails anyone, and a later send reaches only the ones missed.
 * `beforeSending` runs once the quota is secured (it publishes).
 */
async function emailPartialPayers(notification, beforeSending) {
  if (!(await repository.claimEmailSend(notification.id))) {
    throw new ConflictError("This reminder is being emailed right now. Wait for that to finish.", "NOTIFICATION_EMAIL_IN_PROGRESS");
  }
  let reservation = null;
  let reserved = 0;
  let sent = 0;
  let failed = 0;
  try {
    const [recipients, emailed] = await Promise.all([partialPayerRecipients(notification), repository.findEmailedUserIds(notification.id)]);
    const emailedSet = new Set(emailed);
    const pending = recipients.filter((recipient) => !emailedSet.has(recipient.user.id));
    if (pending.length === 0 && notification.emailSentAt) {
      throw new ConflictError("Every student in this reminder has already been emailed.", "NOTIFICATION_ALREADY_EMAILED");
    }
    reservation = await reserveEmailQuota(pending.length, (usage) => notificationEmailRoom(usage));
    reserved = reservation.ok ? pending.length : 0;
    if (!reservation.ok) {
      throw new ConflictError(
        `This would send ${pending.length} emails, but only ${reservation.room} can go out today without risking sign-in and password emails. Publish without email, or try again tomorrow.`,
        "EMAIL_QUOTA_EXCEEDED",
      );
    }
    await beforeSending();

    const dashboardUrl = `${process.env.CLIENT_URL?.replace(/\/$/, "") ?? ""}/dashboard`;
    // Sequential and spaced out: Resend rate-limits bursts.
    for (const [index, { user, balances }] of pending.entries()) {
      if (index > 0) await sleep(EMAIL_SEND_INTERVAL_MS);
      try {
        await sendReminder(user, { studentName: user.firstName, title: notification.title, message: notification.message, balances, dashboardUrl });
        sent += 1;
      } catch (error) {
        failed += 1;
        Logger.error(`[NOTIFICATION_EMAIL_FAILED]: ${notification.id} → ${user.email}`, error);
        continue;
      }
      await repository.markEmailed(notification.id, user.id).catch((error) =>
        Logger.error(`[NOTIFICATION_EMAIL_RECORD_FAILED]: ${notification.id} → ${user.id}`, error),
      );
    }
    await repository.updateNotification(notification.id, {
      emailSentAt: notification.emailSentAt ?? new Date(),
      emailSentCount: await repository.countEmailed(notification.id),
    });
    return { sent, failed };
  } finally {
    // Give back the reserved emails that didn't go out.
    if (reservation?.ok) {
      await releaseEmailQuota(reservation.day, reserved - sent).catch((error) => Logger.error("[EMAIL_QUOTA_RELEASE_FAILED]", error));
    }
    await repository.releaseEmailSend(notification.id).catch((error) => Logger.error(`[NOTIFICATION_EMAIL_CLAIM_RELEASE_FAILED]: ${notification.id}`, error));
  }
}

export async function publishNotificationService(id, data, actorId) {
  const { sendEmail } = parse(publishNotificationSchema, data ?? {});
  const current = await repository.findNotificationById(id);
  if (!current) throw new NotFoundError("Notification not found.");
  if (current.status === "ARCHIVED") throw new ConflictError("An archived notification can't be published.", "NOTIFICATION_ARCHIVED");
  if (sendEmail && current.audience !== "PARTIAL_PAYERS") {
    throw new ValidationError("Email can only be sent for payment reminders.", "sendEmail");
  }
  // Email goes out straight away, so only for a reminder students can see
  // right now (code review M09-05).
  const now = new Date();
  if (sendEmail && current.startsAt && current.startsAt > now) {
    throw new ValidationError("This reminder starts later, and email goes out straight away. Publish it without email, then email it once it's showing.", "sendEmail");
  }
  if (sendEmail && current.endsAt && current.endsAt < now) {
    throw new ValidationError("This reminder has ended, so it can't be emailed.", "sendEmail");
  }

  const publish = () => repository.updateNotification(id, { status: "PUBLISHED", publishedAt: current.publishedAt ?? now });
  let email = null;
  if (sendEmail) email = await emailPartialPayers(current, publish);
  else await publish();

  recordActionService({
    actorUserId: actorId,
    action: sendEmail ? AUDIT_ACTIONS.NOTIFICATION_EMAILED : AUDIT_ACTIONS.NOTIFICATION_PUBLISHED,
    entityType: ENTITY_TYPES.NOTIFICATION,
    entityId: id,
    description: `Published notification "${current.title}"${email ? ` and emailed ${email.sent} student(s)${email.failed ? ` (${email.failed} failed)` : ""}` : ""}.`,
    metadata: { audience: current.audience, emailSentCount: email?.sent ?? 0, emailFailedCount: email?.failed ?? 0 },
  });
  return { ...(await toAdminNotification(await repository.findNotificationById(id))), ...(email ? { emailResult: email } : {}) };
}

export async function archiveNotificationService(id, actorId) {
  const current = await repository.findNotificationById(id);
  if (!current) throw new NotFoundError("Notification not found.");
  await repository.updateNotification(id, { status: "ARCHIVED" });
  recordActionService({
    actorUserId: actorId,
    action: AUDIT_ACTIONS.NOTIFICATION_ARCHIVED,
    entityType: ENTITY_TYPES.NOTIFICATION,
    entityId: id,
    description: `Archived notification "${current.title}".`,
  });
  return toAdminNotification(await repository.findNotificationById(id));
}

export async function deleteNotificationService(id) {
  const current = await repository.findNotificationById(id);
  if (!current) throw new NotFoundError("Notification not found.");
  if (current.status !== "DRAFT") throw new ConflictError("Only drafts can be deleted — archive a published notification instead.", "NOTIFICATION_NOT_DRAFT");
  await repository.deleteNotification(id);
}

// ============================================================ Notifications — student

export async function getMyNotificationsService(user) {
  if (!isLearnerRole(user.role)) return { notifications: [], unreadCount: 0 };
  const [enrollments, interests] = await Promise.all([repository.findStudentEnrollments(user.id), repository.findInterestCourseIds(user.id)]);
  const partial = enrollments.filter((enrollment) => enrollment.paymentStatus === "PARTIAL" && owed(enrollment) > 0);
  const rows = await repository.findVisibleNotifications(user.id, {
    courseIds: [...new Set(enrollments.map((enrollment) => enrollment.courseId))],
    intakeIds: [...new Set(enrollments.map((enrollment) => enrollment.intakeId))],
    partialCourseIds: [...new Set(partial.map((enrollment) => enrollment.courseId))],
    partialIntakeIds: [...new Set(partial.map((enrollment) => enrollment.intakeId))],
    interests,
  });

  const notifications = rows.map((row) => {
    // A payment reminder shows this student's own outstanding balances.
    const balances =
      row.audience === "PARTIAL_PAYERS"
        ? partial
            .filter((enrollment) => (row.intakeId ? enrollment.intakeId === row.intakeId : row.courseId ? enrollment.courseId === row.courseId : true))
            .map((enrollment) => ({ courseTitle: enrollment.course.title, owed: owed(enrollment) }))
        : [];
    return {
      id: row.id,
      title: row.title,
      message: row.message,
      audience: row.audience,
      scope: row.intake?.code ?? row.course?.title ?? null,
      linkLabel: row.linkLabel,
      linkUrl: row.linkUrl,
      pinned: row.pinned,
      publishedAt: row.publishedAt,
      read: Boolean(row.receipts[0]?.readAt),
      dismissible: row.audience !== "PARTIAL_PAYERS",
      balances,
    };
  });
  return { notifications, unreadCount: notifications.filter((notification) => !notification.read).length };
}

async function assertVisible(user, id) {
  const { notifications } = await getMyNotificationsService(user);
  const notification = notifications.find((item) => item.id === id);
  if (!notification) throw new NotFoundError("Notification not found.");
  return notification;
}

export async function markReadService(user, id) {
  await assertVisible(user, id);
  await repository.upsertReceipt(id, user.id, { readAt: new Date() });
}

export async function markAllReadService(user) {
  const { notifications } = await getMyNotificationsService(user);
  await repository.markManyRead(notifications.filter((item) => !item.read).map((item) => item.id), user.id);
}

export async function dismissService(user, id) {
  const notification = await assertVisible(user, id);
  // Payment reminders stay until the student pays (decided 2026-10-01).
  if (!notification.dismissible) throw new ForbiddenError("Payment reminders stay until the balance is paid.");
  await repository.upsertReceipt(id, user.id, { dismissedAt: new Date(), readAt: new Date() });
}

// ============================================================ Promotions

function toPromotion(row, { admin = false } = {}) {
  const base = {
    id: row.id,
    headline: row.headline,
    message: row.message,
    badge: row.badge,
    theme: row.theme,
    imageUrl: row.imageObject?.status === "READY" ? publicObjectUrl(row.imageObject.objectKey) : null,
    ctaLabel: row.ctaLabel,
    ctaUrl: row.ctaUrl,
    showCountdown: row.showCountdown,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    updatedAt: row.updatedAt,
  };
  if (!admin) return base;
  return {
    ...base,
    internalName: row.internalName,
    imageObjectId: row.imageObjectId,
    imageObject: row.imageObject
      ? { id: row.imageObject.id, fileName: row.imageObject.originalFileName, contentType: row.imageObject.contentType, sizeBytes: Number(row.imageObject.actualSizeBytes ?? row.imageObject.declaredSizeBytes), publicUrl: base.imageUrl }
      : null,
    status: row.status,
    isLive: isLive(row),
    publishedAt: row.publishedAt,
    createdBy: row.createdBy ? `${row.createdBy.firstName} ${row.createdBy.lastName}`.trim() : null,
  };
}

export async function getActivePromotionService() {
  const row = await repository.findActivePromotion();
  return row ? toPromotion(row) : null;
}

export async function listPromotionsService(query) {
  const filters = parse(promotionAdminFiltersSchema, query);
  const { total, rows, summary } = await repository.findPromotionsPage(filters);
  const active = await repository.findActivePromotion();
  return {
    promotions: rows.map((row) => ({ ...toPromotion(row, { admin: true }), isShowing: row.id === active?.id })),
    summary,
    pagination: { total, limit: filters.limit, offset: filters.offset, hasMore: filters.offset + rows.length < total },
  };
}

function promotionData(input) {
  return {
    internalName: input.internalName,
    headline: input.headline,
    message: input.message ?? null,
    badge: input.badge ?? null,
    theme: input.theme,
    ctaLabel: input.ctaUrl ? input.ctaLabel ?? null : null,
    ctaUrl: input.ctaUrl ?? null,
    showCountdown: input.showCountdown ?? false,
    startsAt: input.startsAt ? new Date(input.startsAt) : null,
    endsAt: input.endsAt ? new Date(input.endsAt) : null,
  };
}

export async function createPromotionService(data, actorId) {
  const input = parse(savePromotionSchema, data);
  if (input.imageObjectId) await assertAttachableStoredObject(input.imageObjectId, "PROMOTION_IMAGE");
  const { id } = await repository.createPromotion({ ...promotionData(input), imageObjectId: input.imageObjectId ?? null, createdByUserId: actorId });
  return toPromotion(await repository.findPromotionById(id), { admin: true });
}

export async function updatePromotionService(id, data, actorId) {
  const current = await repository.findPromotionById(id);
  if (!current) throw new NotFoundError("Promotion not found.");
  if (current.status === "ARCHIVED") throw new ConflictError("An archived promotion can't be edited.", "PROMOTION_ARCHIVED");
  const input = parse(savePromotionSchema, data);
  const imageChanged = input.imageObjectId !== undefined && input.imageObjectId !== current.imageObjectId;
  if (imageChanged && input.imageObjectId) await assertAttachableStoredObject(input.imageObjectId, "PROMOTION_IMAGE");
  await repository.updatePromotion(id, { ...promotionData(input), ...(imageChanged ? { imageObjectId: input.imageObjectId } : {}) });
  // One image per promotion: the replaced one is deleted from storage.
  if (imageChanged && current.imageObject) {
    deleteStoredObjectService(current.imageObject, actorId).catch((error) =>
      Logger.error(`[PROMOTION_IMAGE_CLEANUP_FAILED]: ${current.imageObject.id}`, error),
    );
  }
  return toPromotion(await repository.findPromotionById(id), { admin: true });
}

export async function publishPromotionService(id, actorId) {
  const current = await repository.findPromotionById(id);
  if (!current) throw new NotFoundError("Promotion not found.");
  if (current.status === "ARCHIVED") throw new ConflictError("An archived promotion can't be published.", "PROMOTION_ARCHIVED");
  // Re-publishing moves it to the front (the newest live promotion shows).
  await repository.updatePromotion(id, { status: "PUBLISHED", publishedAt: new Date() });
  recordActionService({
    actorUserId: actorId,
    action: AUDIT_ACTIONS.PROMOTION_PUBLISHED,
    entityType: ENTITY_TYPES.PROMOTION,
    entityId: id,
    description: `Published landing-page promotion "${current.internalName}".`,
  });
  return toPromotion(await repository.findPromotionById(id), { admin: true });
}

export async function archivePromotionService(id, actorId) {
  const current = await repository.findPromotionById(id);
  if (!current) throw new NotFoundError("Promotion not found.");
  await repository.updatePromotion(id, { status: "ARCHIVED" });
  recordActionService({
    actorUserId: actorId,
    action: AUDIT_ACTIONS.PROMOTION_ARCHIVED,
    entityType: ENTITY_TYPES.PROMOTION,
    entityId: id,
    description: `Archived landing-page promotion "${current.internalName}".`,
  });
  return toPromotion(await repository.findPromotionById(id), { admin: true });
}

export async function deletePromotionService(id, actorId) {
  const current = await repository.findPromotionById(id);
  if (!current) throw new NotFoundError("Promotion not found.");
  if (current.status !== "DRAFT") throw new ConflictError("Only drafts can be deleted — archive a published promotion instead.", "PROMOTION_NOT_DRAFT");
  await repository.deletePromotion(id);
  if (current.imageObject) {
    deleteStoredObjectService(current.imageObject, actorId).catch((error) =>
      Logger.error(`[PROMOTION_IMAGE_CLEANUP_FAILED]: ${current.imageObject.id}`, error),
    );
  }
}

// ============================================================ Course interest ("Notify me")

async function requirePublishedCourse(courseId) {
  const course = await repository.findPublishedCourseForInterest(courseId);
  if (!course || course.service?.status !== "ACTIVE") throw new NotFoundError("Course not found.");
  return course;
}

export async function getInterestService(user, courseId) {
  return { interested: Boolean(await repository.findInterest(user.id, courseId)) };
}

export async function addInterestService(user, courseId) {
  if (!isLearnerRole(user.role)) throw new ForbiddenError("Only students can ask to be notified.");
  await requirePublishedCourse(courseId);
  await repository.upsertInterest(user.id, courseId);
  return { interested: true };
}

export async function removeInterestService(user, courseId) {
  await repository.deleteInterest(user.id, courseId);
  return { interested: false };
}

export async function getInterestCountService(courseId) {
  return { count: await repository.countInterest(courseId) };
}

/**
 * Called when an intake moves to OPEN_ACTIVE: tells every student who
 * pressed "Notify me" on this course. In-app only (no email cost).
 * Best-effort — never blocks the status change itself.
 */
export async function announceCourseOpenService({ courseId, intakeCode }, actorId) {
  const [count, course] = await Promise.all([repository.countInterest(courseId), repository.findPublishedCourseForInterest(courseId)]);
  if (count === 0 || !course) return null;
  const result = await repository.announceCourseOpen({
    courseId,
    title: `Enrollment is open: ${course.title}`,
    message: `You asked us to tell you when ${course.title} opens — intake ${intakeCode} is now taking enrollments. Seats can fill up, so don't wait too long.`,
    linkUrl: course.service?.slug ? `/${course.service.slug}/${course.slug}` : "/explore",
    createdByUserId: actorId,
  });
  recordActionService({
    actorUserId: actorId,
    action: AUDIT_ACTIONS.NOTIFICATION_PUBLISHED,
    entityType: ENTITY_TYPES.NOTIFICATION,
    entityId: result.id,
    description: `Told ${result.notified} interested student(s) that ${course.title} (${intakeCode}) is open.`,
    metadata: { audience: "COURSE_INTEREST", courseId },
  });
  return result;
}
