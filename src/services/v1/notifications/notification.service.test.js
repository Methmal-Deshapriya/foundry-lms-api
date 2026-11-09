import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  // No pauses between reminder emails in tests.
  process.env.NOTIFICATION_EMAIL_INTERVAL_MS = "0";
});

vi.mock("../../../repositories/v1/notifications/notification.repository.js", () => ({
  countAudience: vi.fn(async () => 7),
  findPartialPayers: vi.fn(async () => []),
  findNotificationsPage: vi.fn(),
  findNotificationById: vi.fn(),
  updateNotification: vi.fn(async () => ({})),
  resetReads: vi.fn(),
  claimEmailSend: vi.fn(async () => true),
  releaseEmailSend: vi.fn(async () => ({})),
  findEmailedUserIds: vi.fn(async () => []),
  markEmailed: vi.fn(async () => ({})),
  countEmailed: vi.fn(async () => 0),
  findStudentEnrollments: vi.fn(async () => []),
  findInterestCourseIds: vi.fn(async () => []),
  findVisibleNotifications: vi.fn(async () => []),
  upsertReceipt: vi.fn(),
  countInterest: vi.fn(),
  findPublishedCourseForInterest: vi.fn(),
  announceCourseOpen: vi.fn(),
}));
vi.mock("../../../utils/email.js", () => ({
  getEmailUsage: vi.fn(),
  reserveEmailQuota: vi.fn(),
  releaseEmailQuota: vi.fn(async () => undefined),
  sendPaymentReminderEmail: vi.fn(async () => undefined),
}));
vi.mock("../audit/audit.service.js", () => ({ recordActionService: vi.fn() }));
vi.mock("../storage/storedObject.service.js", () => ({ assertAttachableStoredObject: vi.fn(), deleteStoredObjectService: vi.fn() }));
vi.mock("../../../config/r2.js", () => ({ publicObjectUrl: vi.fn() }));

import * as repository from "../../../repositories/v1/notifications/notification.repository.js";
import { releaseEmailQuota, reserveEmailQuota, sendPaymentReminderEmail } from "../../../utils/email.js";
import {
  dismissService,
  getAudienceReachService,
  getMyNotificationsService,
  listNotificationsService,
  notificationEmailRoom,
  publishNotificationService,
  updateNotificationService,
} from "./notification.service.js";

const student = { id: "student-1", role: "STUDENT" };
const reminder = (overrides = {}) => ({
  id: "n-1",
  title: "Second instalment due",
  message: "Please pay the rest by Friday.",
  audience: "PARTIAL_PAYERS",
  courseId: null,
  intakeId: null,
  status: "DRAFT",
  startsAt: null,
  endsAt: null,
  publishedAt: null,
  emailSentAt: null,
  ...overrides,
});
// A PARTIAL enrollment: agreed 50,000, paid `paid`.
const enrollment = (userId, paid, overrides = {}) => ({
  id: `e-${userId}`,
  courseId: "course-1",
  intakeId: "intake-1",
  paymentStatus: "PARTIAL",
  user: { id: userId, firstName: userId, email: `${userId}@example.com`, role: "STUDENT" },
  course: { title: "AI/ML", price: 50000 },
  agreedPrice: 50000,
  payments: [{ id: `p-${userId}`, type: "INSTALLMENT", amount: paid, discountAmount: 0, correctsPaymentId: null }],
  ...overrides,
});
const usage = (sentToday, sentThisMonth) => ({ sentToday, sentThisMonth, dailyLimit: 100, monthlyLimit: 3000 });

beforeEach(() => {
  vi.clearAllMocks();
  repository.findNotificationById.mockResolvedValue(reminder());
  repository.claimEmailSend.mockResolvedValue(true);
  repository.findEmailedUserIds.mockResolvedValue([]);
  reserveEmailQuota.mockImplementation(async () => ({ ok: true, room: 80, day: new Date("2026-10-02") }));
  sendPaymentReminderEmail.mockResolvedValue(undefined);
});

describe("email quota room (M09-06)", () => {
  it("keeps the daily reserve", () => {
    expect(notificationEmailRoom(usage(10, 100), new Date("2026-10-02T06:00:00Z"))).toBe(70);
  });

  it("keeps a reserve for every day left in the month", () => {
    // 30 Oct: 2 days left, so 40 are kept back from the month's last 90.
    expect(notificationEmailRoom(usage(0, 2910), new Date("2026-10-30T06:00:00Z"))).toBe(50);
  });

  it("never goes below zero", () => {
    expect(notificationEmailRoom(usage(95, 100))).toBe(0);
  });
});

describe("emailing a payment reminder (M09-01 / M09-02 / M09-05)", () => {
  beforeEach(() => {
    repository.findPartialPayers.mockResolvedValue([enrollment("ama", 20000), enrollment("bimal", 50000), enrollment("chathu", 10000)]);
  });

  it("reserves the quota, emails only students who still owe, and records each one", async () => {
    const result = await publishNotificationService("n-1", { sendEmail: true }, "admin-1");

    // bimal paid in full, so only two emails.
    expect(reserveEmailQuota).toHaveBeenCalledWith(2, expect.any(Function));
    expect(sendPaymentReminderEmail).toHaveBeenCalledTimes(2);
    expect(sendPaymentReminderEmail.mock.calls[0][2]).toEqual({ preCounted: true });
    expect(repository.markEmailed).toHaveBeenCalledWith("n-1", "ama");
    expect(repository.markEmailed).toHaveBeenCalledWith("n-1", "chathu");
    expect(repository.updateNotification).toHaveBeenCalledWith("n-1", expect.objectContaining({ status: "PUBLISHED" }));
    expect(releaseEmailQuota).toHaveBeenCalledWith(expect.any(Date), 0);
    expect(repository.releaseEmailSend).toHaveBeenCalledWith("n-1");
    expect(result.emailResult).toEqual({ sent: 2, failed: 0 });
  });

  it("re-sends only to students who were missed", async () => {
    repository.findNotificationById.mockResolvedValue(reminder({ status: "PUBLISHED", emailSentAt: new Date() }));
    repository.findEmailedUserIds.mockResolvedValue(["ama"]);
    await publishNotificationService("n-1", { sendEmail: true }, "admin-1");
    expect(sendPaymentReminderEmail).toHaveBeenCalledTimes(1);
    expect(sendPaymentReminderEmail.mock.calls[0][0]).toBe("chathu@example.com");
  });

  it("refuses when everyone has already been emailed", async () => {
    repository.findNotificationById.mockResolvedValue(reminder({ status: "PUBLISHED", emailSentAt: new Date() }));
    repository.findEmailedUserIds.mockResolvedValue(["ama", "chathu"]);
    await expect(publishNotificationService("n-1", { sendEmail: true }, "admin-1")).rejects.toMatchObject({ code: "NOTIFICATION_ALREADY_EMAILED" });
    expect(sendPaymentReminderEmail).not.toHaveBeenCalled();
    expect(repository.releaseEmailSend).toHaveBeenCalled();
  });

  it("refuses a second send while one is running", async () => {
    repository.claimEmailSend.mockResolvedValue(false);
    await expect(publishNotificationService("n-1", { sendEmail: true }, "admin-1")).rejects.toMatchObject({ code: "NOTIFICATION_EMAIL_IN_PROGRESS" });
    expect(reserveEmailQuota).not.toHaveBeenCalled();
    expect(sendPaymentReminderEmail).not.toHaveBeenCalled();
  });

  it("doesn't publish or send when the quota can't take it", async () => {
    reserveEmailQuota.mockResolvedValue({ ok: false, room: 1, day: null });
    await expect(publishNotificationService("n-1", { sendEmail: true }, "admin-1")).rejects.toMatchObject({ code: "EMAIL_QUOTA_EXCEEDED" });
    expect(repository.updateNotification).not.toHaveBeenCalled();
    expect(sendPaymentReminderEmail).not.toHaveBeenCalled();
    expect(releaseEmailQuota).not.toHaveBeenCalled();
    expect(repository.releaseEmailSend).toHaveBeenCalled();
  });

  it("gives back the quota of failed sends and leaves them for a re-send", async () => {
    sendPaymentReminderEmail.mockRejectedValueOnce(new Error("network"));
    const result = await publishNotificationService("n-1", { sendEmail: true }, "admin-1");
    expect(result.emailResult).toEqual({ sent: 1, failed: 1 });
    expect(repository.markEmailed).toHaveBeenCalledTimes(1);
    expect(releaseEmailQuota).toHaveBeenCalledWith(expect.any(Date), 1);
  });

  it("retries once when Resend rate-limits", async () => {
    sendPaymentReminderEmail.mockRejectedValueOnce(Object.assign(new Error("slow down"), { resendName: "rate_limit_exceeded" }));
    vi.useFakeTimers();
    const pending = publishNotificationService("n-1", { sendEmail: true }, "admin-1");
    await vi.runAllTimersAsync();
    const result = await pending;
    vi.useRealTimers();
    expect(sendPaymentReminderEmail).toHaveBeenCalledTimes(3);
    expect(result.emailResult).toEqual({ sent: 2, failed: 0 });
  });

  it("won't email a reminder that starts later or has ended", async () => {
    repository.findNotificationById.mockResolvedValue(reminder({ startsAt: new Date(Date.now() + 86_400_000) }));
    await expect(publishNotificationService("n-1", { sendEmail: true }, "admin-1")).rejects.toMatchObject({ field: "sendEmail" });
    repository.findNotificationById.mockResolvedValue(reminder({ endsAt: new Date(Date.now() - 86_400_000) }));
    await expect(publishNotificationService("n-1", { sendEmail: true }, "admin-1")).rejects.toMatchObject({ field: "sendEmail" });
    expect(repository.claimEmailSend).not.toHaveBeenCalled();
  });

  it("only emails payment reminders", async () => {
    repository.findNotificationById.mockResolvedValue(reminder({ audience: "ALL_STUDENTS" }));
    await expect(publishNotificationService("n-1", { sendEmail: true }, "admin-1")).rejects.toMatchObject({ field: "sendEmail" });
  });

  it("counts reach the same way as delivery (M09-14)", async () => {
    await expect(getAudienceReachService({ audience: "PARTIAL_PAYERS" })).resolves.toEqual({ reach: 2 });
  });
});

describe("editing a published notification (M09-04)", () => {
  const body = (overrides = {}) => ({ title: "Second instalment due", message: "Please pay the rest by Friday.", audience: "PARTIAL_PAYERS", ...overrides });

  it("refuses to move it to another audience", async () => {
    repository.findNotificationById.mockResolvedValue(reminder({ status: "PUBLISHED", audience: "ALL_STUDENTS" }));
    await expect(updateNotificationService("n-1", body())).rejects.toMatchObject({ code: "NOTIFICATION_AUDIENCE_LOCKED" });
    expect(repository.updateNotification).not.toHaveBeenCalled();
  });

  it("shows changed wording as unread again", async () => {
    repository.findNotificationById.mockResolvedValue(reminder({ status: "PUBLISHED" }));
    await updateNotificationService("n-1", body({ message: "New deadline: Monday." }));
    expect(repository.resetReads).toHaveBeenCalledWith("n-1");
  });

  it("keeps reads when only the schedule changes", async () => {
    repository.findNotificationById.mockResolvedValue(reminder({ status: "PUBLISHED" }));
    await updateNotificationService("n-1", body({ pinned: true }));
    expect(repository.resetReads).not.toHaveBeenCalled();
  });
});

describe("what a student sees", () => {
  it("shows reminder balances for the reminder's own scope, intake first", async () => {
    repository.findStudentEnrollments.mockResolvedValue([
      enrollment("student-1", 20000),
      enrollment("student-1", 10000, { courseId: "course-2", intakeId: "intake-2", course: { title: "Web", price: 50000 } }),
    ]);
    repository.findVisibleNotifications.mockResolvedValue([{ ...reminder({ status: "PUBLISHED", intakeId: "intake-2", courseId: "course-1" }), receipts: [] }]);
    const { notifications } = await getMyNotificationsService(student);
    expect(notifications[0]).toMatchObject({ dismissible: false, balances: [{ courseTitle: "Web", owed: 40000 }] });
    expect(repository.findVisibleNotifications.mock.calls[0][1]).toMatchObject({ partialIntakeIds: ["intake-1", "intake-2"] });
  });

  it("leaves paid-up enrollments out of the reminder audience", async () => {
    repository.findStudentEnrollments.mockResolvedValue([enrollment("student-1", 50000)]);
    await getMyNotificationsService(student);
    expect(repository.findVisibleNotifications.mock.calls[0][1]).toMatchObject({ partialCourseIds: [] });
  });

  it("passes interest dates, so later sign-ups don't see an old 'open' notice (M09-03)", async () => {
    const interests = [{ courseId: "course-3", createdAt: new Date("2026-10-01") }];
    repository.findInterestCourseIds.mockResolvedValue(interests);
    await getMyNotificationsService(student);
    expect(repository.findVisibleNotifications.mock.calls[0][1]).toMatchObject({ interests });
  });

  it("refuses to dismiss a payment reminder", async () => {
    repository.findStudentEnrollments.mockResolvedValue([enrollment("student-1", 20000)]);
    repository.findVisibleNotifications.mockResolvedValue([{ ...reminder({ status: "PUBLISHED" }), receipts: [] }]);
    await expect(dismissService(student, "n-1")).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.upsertReceipt).not.toHaveBeenCalled();
  });

  it("gives non-students nothing", async () => {
    await expect(getMyNotificationsService({ id: "admin-1", role: "ADMIN" })).resolves.toEqual({ notifications: [], unreadCount: 0 });
  });
});

describe("admin list (M09-09)", () => {
  it("counts reach once per audience and skips archived rows", async () => {
    const row = (id, status, audience = "ALL_STUDENTS") => ({ ...reminder({ id, status, audience }), _count: { receipts: 0 } });
    repository.findNotificationsPage.mockResolvedValue({
      total: 3,
      rows: [row("a", "PUBLISHED"), row("b", "DRAFT"), row("c", "ARCHIVED")],
      summary: { all: 3, draft: 1, published: 1, archived: 1 },
    });
    const result = await listNotificationsService({});
    expect(repository.countAudience).toHaveBeenCalledTimes(1);
    expect(result.notifications.map((item) => item.reach)).toEqual([7, 7, null]);
    expect(result.summary).toEqual({ all: 3, draft: 1, published: 1, archived: 1 });
  });
});
