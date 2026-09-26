import "temporal-polyfill/global";

export type Frequency =
  | "ONE_TIME"
  | "DAILY"
  | "WEEKLY"
  | "BIWEEKLY"
  | "MONTHLY"
  | "QUARTERLY"
  | "ANNUALLY"
  | "CUSTOM_DAYS"
  | "CUSTOM_MONTHS";

export type ItemSchedule = {
  startDate: Temporal.PlainDate;
  endDate: Temporal.PlainDate;
  firstExpectedDate: Temporal.PlainDate;
  frequency: Frequency;
  customInterval?: number | null;
};

export type BucketRange = {
  sequence: number;
  startDate: Temporal.PlainDate;
  endDate: Temporal.PlainDate;
  expectedDate: Temporal.PlainDate;
};

const cmp = Temporal.PlainDate.compare;

// Step between occurrences: days or months.
function step(item: ItemSchedule): { days?: number; months?: number } {
  const n = item.customInterval ?? 1;
  switch (item.frequency) {
    case "DAILY":
      return { days: 1 };
    case "WEEKLY":
      return { days: 7 };
    case "BIWEEKLY":
      return { days: 14 };
    case "CUSTOM_DAYS":
      return { days: n };
    case "MONTHLY":
      return { months: 1 };
    case "QUARTERLY":
      return { months: 3 };
    case "ANNUALLY":
      return { months: 12 };
    case "CUSTOM_MONTHS":
      return { months: n };
    case "ONE_TIME":
      return {};
  }
}

// Nominal period length (draft: "(30 days)/2 = 15"); months count as 30 days, years as 365.
function nominalDays(item: ItemSchedule): number {
  const { days, months } = step(item);
  if (days) return days;
  if (months === 12) return 365;
  return (months ?? 0) * 30;
}

export function expectedDates(item: ItemSchedule): Temporal.PlainDate[] {
  if (item.frequency === "ONE_TIME") return [item.firstExpectedDate];
  const { days, months } = step(item);
  const dates: Temporal.PlainDate[] = [];
  for (let k = 0; ; k++) {
    // Always offset from the first date so day 31 doesn't drift to day 28 after February.
    const next = item.firstExpectedDate.add(
      days ? { days: days * k } : { months: (months ?? 0) * k },
    );
    if (cmp(next, item.endDate) > 0) break;
    dates.push(next);
  }
  return dates;
}

/**
 * One bucket per expected occurrence. Each starts half a nominal period before its expected date
 * and ends the day before the next one starts; the first/last are stretched to the item range.
 */
export function generateBuckets(item: ItemSchedule): BucketRange[] {
  const dates = expectedDates(item);
  const half = Math.floor(nominalDays(item) / 2);
  const starts = dates.map((e, i) => (i === 0 ? item.startDate : e.subtract({ days: half })));
  return dates.map((expectedDate, i) => ({
    sequence: i + 1,
    expectedDate,
    startDate: starts[i]!,
    endDate: i + 1 < starts.length ? starts[i + 1]!.subtract({ days: 1 }) : item.endDate,
  }));
}

export function findBucket<
  T extends { startDate: Temporal.PlainDate; endDate: Temporal.PlainDate },
>(buckets: T[], date: Temporal.PlainDate): T | undefined {
  return buckets.find((b) => cmp(b.startDate, date) <= 0 && cmp(date, b.endDate) <= 0);
}
