import test from "node:test";
import assert from "node:assert/strict";

function parseDateLabel(raw, now = new Date("2026-09-19T12:00:00+02:00")) {
  if (!raw) return null;
  const text = raw.trim().toLowerCase();
  const d = new Date(now);
  d.setHours(12,0,0,0);
  if (/^(today|dzisiaj)$/.test(text)) return d.getTime();
  if (/^(yesterday|wczoraj)$/.test(text)) { d.setDate(d.getDate()-1); return d.getTime(); }
  const numeric = text.match(/^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?$/);
  if (numeric) {
    let year = numeric[3] ? Number(numeric[3]) : now.getFullYear();
    if (year < 100) year += 2000;
    return new Date(year, Number(numeric[2])-1, Number(numeric[1]), 12).getTime();
  }
  return null;
}

test("recognizes Polish relative dates", () => {
  assert.equal(new Date(parseDateLabel("dzisiaj")).getDate(), 19);
  assert.equal(new Date(parseDateLabel("wczoraj")).getDate(), 18);
});

test("recognizes numeric date", () => {
  const d = new Date(parseDateLabel("24.05.2026"));
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 4);
  assert.equal(d.getDate(), 24);
});
