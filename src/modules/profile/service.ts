import { prisma } from "../../lib/prisma.js";
import type { z } from "zod";
import type { updateProfileSchema } from "./schemas.js";

const PROFILE_SELECT = {
  id: true,
  email: true,
  username: true,
  firstName: true,
  lastName: true,
  address: true,
  city: true,
  postalCode: true,
  state: true,
  country: true,
  phoneCountryCode: true,
  phoneNumber: true,
  timezone: true,
  themePreference: true,
  onboardingStatus: true,
  createdAt: true,
  updatedAt: true,
} as const;

export function getProfile(userId: string) {
  return prisma.user.findUniqueOrThrow({ where: { id: userId }, select: PROFILE_SELECT });
}

export function updateProfile(userId: string, data: z.output<typeof updateProfileSchema>) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.update({ where: { id: userId }, data, select: PROFILE_SELECT });
    // Keep Better Auth's display name in sync with the profile name.
    if (data.firstName || data.lastName) {
      await tx.user.update({
        where: { id: userId },
        data: { name: `${user.firstName} ${user.lastName}` },
      });
    }
    return user;
  });
}
