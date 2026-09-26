import "temporal-polyfill/global";
import { describe, expect, it } from "vitest";
import { findBucket, generateBuckets, type ItemSchedule } from "../../src/domain/buckets.js";

const d = (s: string) => Temporal.PlainDate.from(s);
const ranges = (item: ItemSchedule) =>
  generateBuckets(item).map((b) => [
    b.startDate.toString(),
    b.endDate.toString(),
    b.expectedDate.toString(),
  ]);

function expectContiguous(item: ItemSchedule) {
  const buckets = generateBuckets(item);
  expect(buckets[0]!.startDate.toString()).toBe(item.startDate.toString());
  expect(buckets.at(-1)!.endDate.toString()).toBe(item.endDate.toString());
  buckets.forEach((b, i) => {
    expect(Temporal.PlainDate.compare(b.startDate, b.expectedDate)).toBeLessThanOrEqual(0);
    expect(Temporal.PlainDate.compare(b.expectedDate, b.endDate)).toBeLessThanOrEqual(0);
    if (i > 0)
      expect(buckets[i - 1]!.endDate.add({ days: 1 }).toString()).toBe(b.startDate.toString());
  });
}

const base = { startDate: d("2027-01-01"), endDate: d("2027-12-31"), customInterval: null };

describe("generateBuckets (FR-020–FR-022)", () => {
  it("Rent monthly on the 20th for 2027: 12 buckets from the 5th to the 4th", () => {
    const r = ranges({ ...base, firstExpectedDate: d("2027-01-20"), frequency: "MONTHLY" });
    expect(r).toHaveLength(12);
    expect(r[0]).toEqual(["2027-01-01", "2027-02-04", "2027-01-20"]);
    expect(r[1]).toEqual(["2027-02-05", "2027-03-04", "2027-02-20"]);
    expect(r[2]).toEqual(["2027-03-05", "2027-04-04", "2027-03-20"]);
    for (let m = 2; m <= 11; m++) {
      expect(r[m - 1]![0]).toBe(`2027-${String(m).padStart(2, "0")}-05`);
    }
    expect(r[11]).toEqual(["2027-12-05", "2027-12-31", "2027-12-20"]);
  });

  it("clamps day 31 to month end without drifting", () => {
    const r = ranges({ ...base, firstExpectedDate: d("2027-01-31"), frequency: "MONTHLY" });
    expect(r.map((x) => x[2]).slice(0, 4)).toEqual([
      "2027-01-31",
      "2027-02-28",
      "2027-03-31",
      "2027-04-30",
    ]);
  });

  it("one-time item: a single bucket covering the whole item range", () => {
    const r = ranges({ ...base, firstExpectedDate: d("2027-06-10"), frequency: "ONE_TIME" });
    expect(r).toEqual([["2027-01-01", "2027-12-31", "2027-06-10"]]);
  });

  it("item shorter than one period: a single bucket", () => {
    const r = ranges({
      startDate: d("2027-03-01"),
      endDate: d("2027-03-10"),
      firstExpectedDate: d("2027-03-05"),
      frequency: "MONTHLY",
      customInterval: null,
    });
    expect(r).toEqual([["2027-03-01", "2027-03-10", "2027-03-05"]]);
  });

  it("daily: one-day buckets", () => {
    const r = ranges({
      startDate: d("2027-01-01"),
      endDate: d("2027-01-05"),
      firstExpectedDate: d("2027-01-01"),
      frequency: "DAILY",
      customInterval: null,
    });
    expect(r).toEqual([
      ["2027-01-01", "2027-01-01", "2027-01-01"],
      ["2027-01-02", "2027-01-02", "2027-01-02"],
      ["2027-01-03", "2027-01-03", "2027-01-03"],
      ["2027-01-04", "2027-01-04", "2027-01-04"],
      ["2027-01-05", "2027-01-05", "2027-01-05"],
    ]);
  });

  it.each([
    ["WEEKLY", null, 7, 3],
    ["BIWEEKLY", null, 14, 7],
    ["CUSTOM_DAYS", 21, 21, 10],
  ] as const)(
    "%s: steps of %s days, buckets start half a period earlier",
    (frequency, customInterval, step, half) => {
      const item = { ...base, firstExpectedDate: d("2027-01-15"), frequency, customInterval };
      const buckets = generateBuckets(item);
      expect(buckets[1]!.expectedDate.toString()).toBe(
        d("2027-01-15").add({ days: step }).toString(),
      );
      expect(buckets[1]!.startDate.toString()).toBe(
        buckets[1]!.expectedDate.subtract({ days: half }).toString(),
      );
      expectContiguous(item);
    },
  );

  it.each([
    ["QUARTERLY", null, 3, 45],
    ["ANNUALLY", null, 12, 182],
    ["CUSTOM_MONTHS", 3, 3, 45],
  ] as const)(
    "%s: steps of months with half = floor(nominal / 2)",
    (frequency, customInterval, months, half) => {
      const item = {
        startDate: d("2027-01-01"),
        endDate: d("2029-12-31"),
        firstExpectedDate: d("2027-02-10"),
        frequency,
        customInterval,
      };
      const buckets = generateBuckets(item);
      expect(buckets[1]!.expectedDate.toString()).toBe(d("2027-02-10").add({ months }).toString());
      expect(buckets[1]!.startDate.toString()).toBe(
        buckets[1]!.expectedDate.subtract({ days: half }).toString(),
      );
      expectContiguous(item);
    },
  );

  it.each(["DAILY", "WEEKLY", "BIWEEKLY", "MONTHLY", "QUARTERLY", "ANNUALLY"] as const)(
    "%s buckets are contiguous and cover the whole item",
    (frequency) => expectContiguous({ ...base, firstExpectedDate: d("2027-01-09"), frequency }),
  );

  it("copies the estimated amount onto every bucket", () => {
    const buckets = generateBuckets({
      ...base,
      firstExpectedDate: d("2027-01-20"),
      frequency: "MONTHLY",
    });
    expect(buckets.map((b) => b.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });
});

describe("findBucket", () => {
  const buckets = generateBuckets({
    ...base,
    firstExpectedDate: d("2027-01-20"),
    frequency: "MONTHLY",
  });
  it.each([
    ["2027-01-01", 1],
    ["2027-02-04", 1],
    ["2027-02-05", 2],
    ["2027-02-18", 2],
    ["2027-03-04", 2],
    ["2027-12-31", 12],
  ])("%s belongs to bucket #%i", (date, sequence) => {
    expect(findBucket(buckets, d(date))?.sequence).toBe(sequence);
  });
  it("returns undefined outside the item range", () => {
    expect(findBucket(buckets, d("2028-01-01"))).toBeUndefined();
  });
});
