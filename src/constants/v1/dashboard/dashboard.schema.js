import { z } from "zod";

// The admin dashboard's trend charts (enrollments/revenue) accept either a
// preset lookback window (?months=3|6|12, the filter pills) or an explicit
// custom range (?from=&to=, the calendar picker) — never expected together,
// but if both arrive, resolveTrendWindow in the repository just prefers the
// explicit dates. Every other widget on the dashboard is an all-time
// snapshot and ignores these params entirely.
export const adminDashboardQuerySchema = z
  .object({
    months: z.coerce.number().int().min(1).max(24).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    message: "The from date must not be after the to date.",
    path: ["from"],
  });
