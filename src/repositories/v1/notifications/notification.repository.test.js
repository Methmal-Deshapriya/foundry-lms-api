import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    notification: { findMany: vi.fn(async () => []), updateMany: vi.fn() },
  },
}));
vi.mock("../../../utils/prisma.js", () => ({ default: mocks.prisma }));

import { claimEmailSend, findVisibleNotifications } from "./notification.repository.js";

const scope = { courseIds: [], intakeIds: [], partialCourseIds: [], partialIntakeIds: [] };

beforeEach(() => vi.clearAllMocks());

describe("notification visibility", () => {
  it("shows an 'open' notice only to students who asked before it went out (M09-03)", async () => {
    const createdAt = new Date("2026-10-01T00:00:00Z");
    await findVisibleNotifications("student-1", { ...scope, interests: [{ courseId: "course-1", createdAt }] });
    const { where } = mocks.prisma.notification.findMany.mock.calls[0][0];
    expect(where.OR).toContainEqual({ audience: "COURSE_INTEREST", courseId: "course-1", publishedAt: { gte: createdAt } });
  });

  it("never hides a payment reminder because of an old dismissal (M09-04)", async () => {
    await findVisibleNotifications("student-1", scope);
    const { where } = mocks.prisma.notification.findMany.mock.calls[0][0];
    expect(where.NOT).toEqual({ audience: { not: "PARTIAL_PAYERS" }, receipts: { some: { userId: "student-1", dismissedAt: { not: null } } } });
  });
});

describe("email send claim (M09-01)", () => {
  it("claims only a free or abandoned send", async () => {
    mocks.prisma.notification.updateMany.mockResolvedValue({ count: 1 });
    const now = new Date("2026-10-02T10:00:00Z");
    await expect(claimEmailSend("n-1", now)).resolves.toBe(true);
    expect(mocks.prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { id: "n-1", OR: [{ emailSendingAt: null }, { emailSendingAt: { lt: new Date("2026-10-02T09:45:00Z") } }] },
      data: { emailSendingAt: now },
    });
  });

  it("reports a send already running", async () => {
    mocks.prisma.notification.updateMany.mockResolvedValue({ count: 0 });
    await expect(claimEmailSend("n-1")).resolves.toBe(false);
  });
});
