/** @typedef {{ start: string, end: string }} TimeRange */

/**
 * @param {Date} date
 * @param {string} timeZone
 */
export function getLocalParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour === "24" ? 0 : parts.hour),
    minute: Number(parts.minute),
  };
}

/**
 * Build a Date for a local wall-clock time in the given IANA timezone.
 * Uses iterative offset correction (good enough for scheduling slots).
 */
export function dateInTimeZone({ year, month, day, hour, minute }, timeZone) {
  let guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  for (let i = 0; i < 3; i++) {
    const local = getLocalParts(guess, timeZone);
    const targetUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
    const actualUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, 0);
    guess = new Date(guess.getTime() + (targetUtc - actualUtc));
  }
  return guess;
}

/**
 * @param {TimeRange} slot
 * @param {TimeRange[]} busy
 */
export function slotOverlapsBusy(slot, busy) {
  const start = new Date(slot.start).getTime();
  const end = new Date(slot.end).getTime();
  return busy.some((b) => {
    const bs = new Date(b.start).getTime();
    const be = new Date(b.end).getTime();
    return start < be && end > bs;
  });
}

/**
 * @param {TimeRange} requested
 * @param {TimeRange[]} slots
 */
export function slotFitsRequest(requested, slots) {
  const rs = new Date(requested.start).getTime();
  const re = new Date(requested.end).getTime();
  return slots.some((s) => {
    const ss = new Date(s.start).getTime();
    const se = new Date(s.end).getTime();
    return ss <= rs && se >= re;
  });
}

/**
 * Find open meeting slots during working hours, skipping busy periods.
 */
export function findOpenSlots({
  from,
  to,
  durationMin = 30,
  busy = [],
  timeZone = "UTC",
  workStartHour = 10,
  workEndHour = 18,
  maxSlots = 3,
  slotStepMin = 30,
}) {
  const durationMs = durationMin * 60 * 1000;
  const stepMs = slotStepMin * 60 * 1000;
  const results = [];
  const cursor = new Date(from);
  const endBound = new Date(to);

  while (cursor < endBound && results.length < maxSlots) {
    const local = getLocalParts(cursor, timeZone);
    const dayStart = dateInTimeZone(
      { year: local.year, month: local.month, day: local.day, hour: workStartHour, minute: 0 },
      timeZone,
    );
    const dayEnd = dateInTimeZone(
      { year: local.year, month: local.month, day: local.day, hour: workEndHour, minute: 0 },
      timeZone,
    );

    let slotStart = new Date(Math.max(dayStart.getTime(), cursor.getTime()));
    while (slotStart.getTime() + durationMs <= dayEnd.getTime() && results.length < maxSlots) {
      if (slotStart >= endBound) break;
      const slotEnd = new Date(slotStart.getTime() + durationMs);
      const candidate = { start: slotStart.toISOString(), end: slotEnd.toISOString() };
      if (slotStart > new Date() && !slotOverlapsBusy(candidate, busy)) {
        results.push({
          ...candidate,
          label: formatSlotLabel(slotStart, slotEnd, timeZone),
        });
      }
      slotStart = new Date(slotStart.getTime() + stepMs);
    }

    const nextDay = dateInTimeZone(
      { year: local.year, month: local.month, day: local.day + 1, hour: 0, minute: 0 },
      timeZone,
    );
    cursor.setTime(nextDay.getTime());
  }

  return results;
}

export function formatSlotLabel(start, end, timeZone) {
  const opts = {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  };
  const s = start instanceof Date ? start : new Date(start);
  const e = end instanceof Date ? end : new Date(end);
  return `${s.toLocaleString(undefined, opts)} – ${e.toLocaleString(undefined, { timeZone, hour: "numeric", minute: "2-digit" })}`;
}
