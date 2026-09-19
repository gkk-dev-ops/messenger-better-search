/**
 * Shared local-calendar helpers used by both the Messenger content script and tests.
 * The module also exposes the helpers on globalThis because Manifest V3 content
 * scripts are loaded as classic scripts rather than ES modules.
 */
(function exposeDateUtils(root) {
  const MONTHS = {
    jan: 0, january: 0, sty: 0, stycznia: 0,
    feb: 1, february: 1, lut: 1, lutego: 1,
    mar: 2, march: 2, marca: 2,
    apr: 3, april: 3, kwi: 3, kwietnia: 3,
    may: 4, maj: 4, maja: 4,
    jun: 5, june: 5, cze: 5, czerwca: 5,
    jul: 6, july: 6, lip: 6, lipca: 6,
    aug: 7, august: 7, sie: 7, sierpnia: 7,
    sep: 8, september: 8, wrz: 8, września: 8,
    oct: 9, october: 9, paź: 9, października: 9,
    nov: 10, november: 10, lis: 10, listopada: 10,
    dec: 11, december: 11, gru: 11, grudnia: 11
  };

  /**
   * Builds a local-noon date and rejects JavaScript's normalized impossible dates.
   * @param {number} year
   * @param {number} monthIndex Zero-based month.
   * @param {number} day
   * @returns {Date|null}
   */
  function buildValidatedLocalDate(year, monthIndex, day) {
    if (!Number.isInteger(year) || !Number.isInteger(monthIndex) || !Number.isInteger(day)) return null;
    if (monthIndex < 0 || monthIndex > 11 || day < 1 || day > 31) return null;

    const date = new Date(year, monthIndex, day, 12, 0, 0, 0);
    if (
      date.getFullYear() !== year ||
      date.getMonth() !== monthIndex ||
      date.getDate() !== day
    ) {
      return null;
    }
    return date;
  }

  /**
   * Parses Messenger-style English or Polish date separators into a local timestamp.
   * @param {string} raw
   * @param {Date} [now]
   * @returns {number|null}
   */
  function parseDateLabel(raw, now = new Date()) {
    if (!raw) return null;
    const text = raw.trim().toLowerCase();
    const relative = new Date(now);
    relative.setHours(12, 0, 0, 0);

    if (/^(today|dzisiaj)$/.test(text)) return relative.getTime();
    if (/^(yesterday|wczoraj)$/.test(text)) {
      relative.setDate(relative.getDate() - 1);
      return relative.getTime();
    }

    const numeric = text.match(/^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?$/);
    if (numeric) {
      let year = numeric[3] ? Number(numeric[3]) : now.getFullYear();
      if (year < 100) year += 2000;
      const date = buildValidatedLocalDate(year, Number(numeric[2]) - 1, Number(numeric[1]));
      return date?.getTime() ?? null;
    }

    const named = text.match(/^(\d{1,2})\s+([^\s]+)(?:\s+(\d{4}))?$/);
    if (named) {
      const token = named[2].replace(/[.,]/g, "");
      const month = MONTHS[token] ?? MONTHS[token.slice(0, 3)];
      if (month !== undefined) {
        const year = named[3] ? Number(named[3]) : now.getFullYear();
        const date = buildValidatedLocalDate(year, month, Number(named[1]));
        return date?.getTime() ?? null;
      }
    }

    return null;
  }

  /**
   * Creates a YYYY-MM-DD key using the user's local calendar rather than UTC.
   * @param {number|Date} value
   * @returns {string}
   */
  function localDayKey(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "unknown";
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  root.MessengerMemoryDate = Object.freeze({
    buildValidatedLocalDate,
    parseDateLabel,
    localDayKey
  });
})(globalThis);
