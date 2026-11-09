import { describe, expect, it } from "vitest";
import { selectExpiredBackups } from "./backupRetention.js";

const prefix = "backups/";
// One dump a day from 1 Jan to 30 Jun 2026.
const daily = [];
for (let day = new Date(Date.UTC(2026, 0, 1)); day <= new Date(Date.UTC(2026, 5, 30)); day.setUTCDate(day.getUTCDate() + 1)) {
  daily.push(`${prefix}${day.toISOString().slice(0, 10)}T20-30-05-123Z.dump`);
}

describe("backup retention (M10-11)", () => {
  it("keeps the newest 14 dumps and the first dump of each month", () => {
    const expired = selectExpiredBackups(daily, { prefix, keepDaily: 14, keepMonthly: 12 });
    const kept = daily.filter((key) => !expired.includes(key));
    expect(kept.filter((key) => key >= `${prefix}2026-06-17`)).toHaveLength(14);
    for (const month of ["01", "02", "03", "04", "05", "06"]) expect(kept).toContain(`${prefix}2026-${month}-01T20-30-05-123Z.dump`);
    expect(kept).toHaveLength(14 + 6);
  });

  it("keeps only the newest months when there are more", () => {
    const expired = selectExpiredBackups(daily, { prefix, keepDaily: 3, keepMonthly: 2 });
    const kept = daily.filter((key) => !expired.includes(key));
    expect(kept).toContain(`${prefix}2026-05-01T20-30-05-123Z.dump`);
    expect(kept).not.toContain(`${prefix}2026-04-01T20-30-05-123Z.dump`);
  });

  it("never deletes anything while there are few dumps", () => {
    expect(selectExpiredBackups(daily.slice(0, 5), { prefix, keepDaily: 14, keepMonthly: 12 })).toEqual([]);
  });
});
