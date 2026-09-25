import "temporal-polyfill/global";
import { AppError } from "./errors.js";

// `@db.Date` columns come back as UTC-midnight Date objects.
export function toPlainDate(date: Date): Temporal.PlainDate {
  return Temporal.PlainDate.from(date.toISOString().slice(0, 10));
}

export function fromPlainDate(date: Temporal.PlainDate | string): Date {
  return new Date(`${date.toString()}T00:00:00.000Z`);
}

export function todayIn(timezone: string): Temporal.PlainDate {
  return Temporal.Now.plainDateISO(timezone);
}

/**
 * Interprets a local "YYYY-MM-DDTHH:mm" in an IANA timezone.
 * Nonexistent times (DST spring-forward) are rejected; ambiguous ones use the earlier offset.
 */
export function zonedFromLocal(localDateTime: string, timezone: string): Temporal.ZonedDateTime {
  const local = Temporal.PlainDateTime.from(localDateTime);
  const zoned = local.toZonedDateTime(timezone, { disambiguation: "earlier" });
  if (!zoned.toPlainDateTime().equals(local)) {
    throw new AppError(
      422,
      "VALIDATION_ERROR",
      "That time doesn't exist in your timezone because of daylight saving.",
      {
        localDateTime: "That time doesn't exist in your timezone because of daylight saving.",
      },
    );
  }
  return zoned;
}

export function comparePlainDates(a: Temporal.PlainDate, b: Temporal.PlainDate): number {
  return Temporal.PlainDate.compare(a, b);
}
