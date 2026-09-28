// Paste-ready "available times" text for prospect emails (Future Features #4). Pure.

/** Merge adjacent offerable segments into plain ranges; which SE is free is irrelevant to a prospect. */
export function mergeRuns(offerable) {
  const runs = [];
  for (const seg of offerable) {
    const last = runs[runs.length - 1];
    if (last && last.end === seg.start) last.end = seg.end;
    else runs.push({ start: seg.start, end: seg.end });
  }
  return runs;
}

/** Short zone label for a moment, e.g. "CDT" / "EST". Falls back to the IANA name if the locale gives none. */
export function zoneLabel(at = Date.now(), locale = []) {
  const parts = new Intl.DateTimeFormat(locale, { timeZoneName: 'short' }).formatToParts(new Date(at));
  return parts.find((p) => p.type === 'timeZoneName')?.value ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * @param {Array<{ start: number, end: number }>} offerable  Sorted segments (from computeAvailability).
 * @param {{ zone?: string, locale?: string|string[], intro?: string }} [opts]
 * @returns {string}  '' when there is nothing to offer.
 */
export function formatSlotsText(offerable, { zone, locale = [], intro = 'Here are some times that work on our end' } = {}) {
  const runs = mergeRuns(offerable);
  if (!runs.length) return '';
  const z = zone ?? zoneLabel(runs[0].start, locale);
  const time = (ms) => new Date(ms).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
  const day = (ms) => new Date(ms).toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' });

  const byDay = new Map();
  for (const r of runs) {
    const key = new Date(r.start).toDateString();
    if (!byDay.has(key)) byDay.set(key, { label: day(r.start), ranges: [] });
    byDay.get(key).ranges.push(`${time(r.start)} – ${time(r.end)}`);
  }
  const lines = [...byDay.values()].map((d) => `• ${d.label}: ${d.ranges.join(', ')}`);
  return `${intro} (all times ${z}):\n${lines.join('\n')}`;
}
