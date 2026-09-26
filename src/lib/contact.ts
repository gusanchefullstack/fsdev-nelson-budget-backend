// Optional contact fields shared by accounts, payors and vendors (FR-030, FR-031)
export const CONTACT_KEYS = [
  "address",
  "city",
  "postalCode",
  "state",
  "country",
  "phoneCountryCode",
  "phoneNumber",
] as const;

export function pickContact(row: Record<string, unknown>) {
  return Object.fromEntries(CONTACT_KEYS.map((k) => [k, row[k] ?? null]));
}

export const referencedMessage = (what: string, count: number) =>
  `This ${what} is used by ${count} transaction${count === 1 ? "" : "s"}, so it can't be deleted.`;
