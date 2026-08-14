import assert from "node:assert/strict";
import test from "node:test";
import { formatTopicDates } from "./topic-date";

test("formats one event date", () => {
  assert.equal(formatTopicDates({ articles: [{ eventDate: "2026-08-15" }] }).eventDates, "2026-08-15");
});

test("deduplicates and sorts event dates", () => {
  const result = formatTopicDates({
    articles: [
      { eventDate: "2026-08-16" },
      { eventDate: "2026-08-15" },
      { eventDate: "2026-08-15" },
    ],
  });
  assert.equal(result.eventDates, "2026-08-15, 2026-08-16");
});

test("shows every distinct event date in ascending order", () => {
  const result = formatTopicDates({
    articles: [{ eventDate: "2026-09-01" }, { eventDate: "2026-08-31" }],
  });
  assert.equal(result.eventDates, "2026-08-31, 2026-09-01");
});

test("shows unavailable when no valid event date exists", () => {
  const result = formatTopicDates({
    articles: [{ eventDate: null }, {}, { eventDate: "2026-02-30" }],
  });
  assert.equal(result.eventDates, "확인 불가");
});

test("formats one published date in Asia/Seoul", () => {
  const result = formatTopicDates({
    articles: [{ publishedAt: "2026-08-13T03:00:00Z" }],
  });
  assert.equal(result.publishedDates, "2026-08-13");
});

test("formats the earliest and latest published date as a range", () => {
  const result = formatTopicDates({
    articles: [
      { publishedAt: "2026-08-14T03:00:00Z" },
      { publishedAt: "2026-08-13T03:00:00Z" },
      { publishedAt: "2026-08-14T12:00:00Z" },
    ],
  });
  assert.equal(result.publishedDates, "2026-08-13 ~ 2026-08-14");
});

test("converts a UTC timestamp across the Asia/Seoul date boundary", () => {
  const result = formatTopicDates({
    articles: [{ publishedAt: "2026-08-13T15:00:00Z" }],
  });
  assert.equal(result.publishedDates, "2026-08-14");
});

test("ignores null, missing, and invalid date values", () => {
  const result = formatTopicDates({
    articles: [
      { eventDate: null, publishedAt: null },
      {},
      { eventDate: "not-a-date", publishedAt: "not-a-date" },
      { eventDate: "2026-02-30", publishedAt: "2026-02-30T00:00:00Z" },
    ],
  });
  assert.deepEqual(result, { eventDates: "확인 불가", publishedDates: "확인 불가" });
});

test("supports legacy responses with empty or missing articles", () => {
  assert.deepEqual(formatTopicDates({ articles: [] }), {
    eventDates: "확인 불가",
    publishedDates: "확인 불가",
  });
  assert.deepEqual(formatTopicDates({}), {
    eventDates: "확인 불가",
    publishedDates: "확인 불가",
  });
});
