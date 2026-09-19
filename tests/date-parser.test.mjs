import test from "node:test";
import assert from "node:assert/strict";
import "../src/date-utils.js";

const {
  parseDateLabel,
  localDayKey
} = globalThis.MessengerMemoryDate;

const NOW = new Date(2026, 8, 19, 12, 0, 0, 0);

test("recognizes Polish relative dates", () => {
  assert.equal(new Date(parseDateLabel("dzisiaj", NOW)).getDate(), 19);
  assert.equal(new Date(parseDateLabel("wczoraj", NOW)).getDate(), 18);
});

test("recognizes numeric date", () => {
  const date = new Date(parseDateLabel("24.05.2026", NOW));
  assert.equal(date.getFullYear(), 2026);
  assert.equal(date.getMonth(), 4);
  assert.equal(date.getDate(), 24);
});

test("recognizes named Polish date", () => {
  const date = new Date(parseDateLabel("24 maja 2026", NOW));
  assert.equal(date.getFullYear(), 2026);
  assert.equal(date.getMonth(), 4);
  assert.equal(date.getDate(), 24);
});

test("rejects impossible normalized calendar dates", () => {
  assert.equal(parseDateLabel("31.02.2026", NOW), null);
  assert.equal(parseDateLabel("00.13.2026", NOW), null);
  assert.equal(parseDateLabel("31 kwietnia 2026", NOW), null);
});

test("creates local day keys instead of UTC-derived keys", () => {
  const date = new Date(2026, 4, 24, 0, 30, 0, 0);
  assert.equal(localDayKey(date), "2026-05-24");
});
