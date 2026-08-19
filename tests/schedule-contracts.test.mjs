import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_OFFSET_MINUTES,
  describeSchedule,
  nextRunAt,
  validateSchedule,
} from "../lib/schedule-contracts.ts";

const ISTANBUL = { hour: 4, minute: 0, offsetMinutes: DEFAULT_OFFSET_MINUTES };

test("the next run is the coming 04:00 local, expressed in UTC", () => {
  // 2026-08-19T22:00Z is 01:00 on the 20th in Istanbul, so 04:00 is later today.
  const next = nextRunAt(ISTANBUL, new Date("2026-08-19T22:00:00.000Z"));
  assert.equal(next.toISOString(), "2026-08-20T01:00:00.000Z");
});

test("a time that has already passed today lands on tomorrow", () => {
  // 06:00 local on the 20th; 04:00 is behind us, so the next is the 21st.
  const next = nextRunAt(ISTANBUL, new Date("2026-08-20T03:00:00.000Z"));
  assert.equal(next.toISOString(), "2026-08-21T01:00:00.000Z");
});

test("the exact scheduled instant moves to the next day, never repeats", () => {
  const exact = new Date("2026-08-20T01:00:00.000Z");
  const next = nextRunAt(ISTANBUL, exact);
  assert.equal(next.toISOString(), "2026-08-21T01:00:00.000Z");
});

test("successive runs stay exactly one day apart across a month boundary", () => {
  let cursor = new Date("2026-08-31T02:00:00.000Z");
  const runs = [];
  for (let index = 0; index < 3; index += 1) {
    cursor = nextRunAt(ISTANBUL, cursor);
    runs.push(cursor.toISOString());
  }
  assert.deepEqual(runs, [
    "2026-09-01T01:00:00.000Z",
    "2026-09-02T01:00:00.000Z",
    "2026-09-03T01:00:00.000Z",
  ]);
});

test("a negative offset is handled as well as a positive one", () => {
  const newYork = { hour: 23, minute: 30, offsetMinutes: -300 };
  const next = nextRunAt(newYork, new Date("2026-08-20T02:00:00.000Z"));
  // 02:00Z is 21:30 on the 19th in New York, so 23:30 the same evening is next.
  assert.equal(next.toISOString(), "2026-08-20T04:30:00.000Z");
});

test("only whole hours and five-minute steps are accepted", () => {
  const good = validateSchedule({ kind: "restart", hour: 4, minute: 30, enabled: true });
  assert.equal(good.ok, true);
  assert.equal(good.schedule.offsetMinutes, DEFAULT_OFFSET_MINUTES);

  for (const input of [
    { hour: 24, minute: 0, enabled: true },
    { hour: -1, minute: 0, enabled: true },
    { hour: 4, minute: 7, enabled: true },
    { hour: 4, minute: 60, enabled: true },
    { hour: 4.5, minute: 0, enabled: true },
  ]) {
    const result = validateSchedule(input);
    assert.equal(result.ok, false, `kabul edilmemeliydi: ${JSON.stringify(input)}`);
    assert.equal(result.code, "INVALID_SCHEDULE_TIME");
  }
});

test("a schedule must say whether it is on, and cannot invent a kind", () => {
  assert.equal(validateSchedule({ hour: 4, minute: 0 }).code, "INVALID_SCHEDULE");
  assert.equal(validateSchedule({ kind: "wipe", hour: 4, minute: 0, enabled: true }).code, "INVALID_SCHEDULE_KIND");
  assert.equal(validateSchedule("04:00").code, "INVALID_SCHEDULE");
  assert.equal(validateSchedule(null).code, "INVALID_SCHEDULE");
});

test("the description says plainly what will happen", () => {
  assert.match(
    describeSchedule({ kind: "restart", hour: 4, minute: 5, offsetMinutes: 180, enabled: true }),
    /Her gün 04:05/,
  );
  assert.match(
    describeSchedule({ kind: "restart", hour: 4, minute: 0, offsetMinutes: 180, enabled: false }),
    /kapalı/,
  );
});
