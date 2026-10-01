import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../repositories/v1/partners/partner.repository.js", () => ({
  findPartners: vi.fn(),
  findShareSets: vi.fn(),
  createShareSet: vi.fn(),
}));
vi.mock("../audit/audit.service.js", () => ({ recordActionService: vi.fn() }));

import * as repository from "../../../repositories/v1/partners/partner.repository.js";
import { createShareSetService } from "./partner.service.js";
import { colomboDateString } from "../../../utils/colomboTime.js";

const ids = ["10000000-0000-4000-8000-000000000001", "10000000-0000-4000-8000-000000000002", "10000000-0000-4000-8000-000000000003"];
const entries = [{ partnerId: ids[0], percent: 37.5 }, { partnerId: ids[1], percent: 37.5 }, { partnerId: ids[2], percent: 25 }];
const dayFromNow = (days) => colomboDateString(new Date(Date.now() + days * 86_400_000));

describe("starting a new partner split (M03-05)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repository.findPartners.mockResolvedValue(ids.map((id, index) => ({ id, name: `P${index}`, displayOrder: index })));
    repository.findShareSets.mockResolvedValue([{ id: "s-0", effectiveFrom: new Date("2020-01-01T00:00:00.000Z"), entries: [] }]);
    repository.createShareSet.mockResolvedValue({ id: "s-1" });
  });

  it("refuses a start date in the past", async () => {
    await expect(createShareSetService({ effectiveFrom: dayFromNow(-30), entries }, "admin-1")).rejects.toMatchObject({ code: "SHARE_SET_BACKDATED" });
    expect(repository.createShareSet).not.toHaveBeenCalled();
  });

  it("refuses today, which would re-split payments already recorded today", async () => {
    await expect(createShareSetService({ effectiveFrom: dayFromNow(0), entries }, "admin-1")).rejects.toMatchObject({ code: "SHARE_SET_BACKDATED" });
  });

  it("starts a future split at 00:00 Sri Lanka time on that day", async () => {
    const day = dayFromNow(3);
    await createShareSetService({ effectiveFrom: day, entries }, "admin-1");
    const { effectiveFrom } = repository.createShareSet.mock.calls[0][0];
    expect(colomboDateString(effectiveFrom)).toBe(day);
    expect(effectiveFrom.toISOString().slice(11)).toBe("18:30:00.000Z");
  });
});
