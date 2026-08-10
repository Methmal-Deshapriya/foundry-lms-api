import { describe, expect, it } from "vitest";
import { sequenceRiskDetails } from "./batch.repository.js";

const curriculum = ["First", "Second", "Third"].map((title, orderIndex) => ({
  id: `course-session-${orderIndex + 1}`,
  orderIndex,
  session: { title },
}));

describe("batch delivery sequence analysis", () => {
  it("blocks a later release while an earlier session is unreleased", () => {
    const risk = sequenceRiskDetails(
      curriculum,
      new Map(),
      "course-session-2",
      "RELEASED",
    );
    expect(risk).toMatchObject({
      warningCode: "EARLIER_SESSIONS_UNRELEASED",
      confirmationText: "CONFIRM",
      conflicts: [{ courseSessionId: "course-session-1" }],
    });
  });

  it("allows the next session after the preceding session is committed", () => {
    const risk = sequenceRiskDetails(
      curriculum,
      new Map([
        ["course-session-1", { isReleased: true, availableAt: null }],
      ]),
      "course-session-2",
      "SCHEDULED",
    );
    expect(risk).toBeNull();
  });

  it("blocks withdrawing an earlier session while a later one is committed", () => {
    const deliveries = new Map([
      ["course-session-1", { isReleased: true, availableAt: null }],
      ["course-session-2", { isReleased: true, availableAt: null }],
    ]);
    expect(
      sequenceRiskDetails(
        curriculum,
        deliveries,
        "course-session-1",
        "UNRELEASED",
      ),
    ).toMatchObject({ warningCode: "LATER_SESSIONS_ALREADY_COMMITTED" });
  });
});
