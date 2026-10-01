/**
 * Sri Lanka calendar helpers. The academy runs on Asia/Colombo (UTC+05:30,
 * no daylight saving), but the server may run in UTC — so "today", "this
 * year" and day boundaries are computed here, never with the server's own
 * local time (code review M03-02/05/07/12/13).
 */
export const COLOMBO_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The Colombo calendar date of an instant, as "YYYY-MM-DD". */
export function colomboDateString(date = new Date()) {
  return new Date(new Date(date).getTime() + COLOMBO_OFFSET_MS).toISOString().slice(0, 10);
}

/** The Colombo calendar year of an instant. */
export function colomboYear(date = new Date()) {
  return Number(colomboDateString(date).slice(0, 4));
}

/** 00:00 Colombo on the day of `date`, as an instant. */
export function startOfColomboDay(date = new Date()) {
  return new Date(Date.parse(`${colomboDateString(date)}T00:00:00.000Z`) - COLOMBO_OFFSET_MS);
}

/** The last millisecond of the Colombo day of `date`. */
export function endOfColomboDay(date = new Date()) {
  return new Date(startOfColomboDay(date).getTime() + DAY_MS - 1);
}
