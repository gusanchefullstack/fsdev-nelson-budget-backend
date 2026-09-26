import { describe, expect, it } from "vitest";
import { zonedFromLocal } from "../../src/lib/temporal.js";

describe("zonedFromLocal (FR-042a, DST edge cases)", () => {
  it("rejects a time that doesn't exist (spring forward)", () => {
    expect(() => zonedFromLocal("2027-03-14T02:30", "America/Los_Angeles")).toThrow(
      /daylight saving/,
    );
  });

  it("uses the earlier offset for an ambiguous time (fall back)", () => {
    const z = zonedFromLocal("2027-11-07T01:30", "America/Los_Angeles");
    expect(z.offset).toBe("-07:00");
  });

  it("keeps the local calendar date of the chosen timezone", () => {
    const bogota = zonedFromLocal("2027-02-18T20:00", "America/Bogota");
    expect(bogota.toPlainDate().toString()).toBe("2027-02-18");
    expect(bogota.toInstant().toString()).toBe("2027-02-19T01:00:00Z");
    // The same instant is already the 19th in Tokyo.
    expect(bogota.withTimeZone("Asia/Tokyo").toPlainDate().toString()).toBe("2027-02-19");
  });
});
