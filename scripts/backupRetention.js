// Which backups to delete (code review M10-11). Keeps the newest `keepDaily`
// dumps, plus the first dump of each of the newest `keepMonthly` months, so
// damage noticed weeks later still has a clean copy from before it.
//
// Keys end in a UTC timestamp ("backups/2026-10-01T20-30-05-123Z.dump"), so
// sorting by name sorts by age, and characters [0, 7) of the stamp are the
// month.
export function selectExpiredBackups(keys, { prefix, keepDaily, keepMonthly }) {
  const newestFirst = [...keys].sort().reverse();
  const keep = new Set(newestFirst.slice(0, keepDaily));

  const firstOfMonth = new Map();
  for (const key of [...newestFirst].reverse()) {
    const month = key.slice(prefix.length, prefix.length + 7);
    if (/^\d{4}-\d{2}$/.test(month) && !firstOfMonth.has(month)) firstOfMonth.set(month, key);
  }
  const months = [...firstOfMonth.keys()].sort().reverse().slice(0, keepMonthly);
  for (const month of months) keep.add(firstOfMonth.get(month));

  return newestFirst.filter((key) => !keep.has(key));
}
