import { notFound } from "./errors.js";
import type { Tx } from "./prisma.js";
import { prisma } from "./prisma.js";

// Records owned by someone else behave as if they don't exist (FR-005).
export async function ownedBudget(userId: string, id: string, db: Tx | typeof prisma = prisma) {
  const budget = await db.budget.findFirst({ where: { id, userId } });
  if (!budget) throw notFound("We couldn't find that budget.");
  return budget;
}

export async function ownedCategory(userId: string, id: string, db: Tx | typeof prisma = prisma) {
  const category = await db.category.findFirst({
    where: { id, budget: { userId } },
    include: { budget: true },
  });
  if (!category) throw notFound("We couldn't find that category.");
  return category;
}

export async function ownedItem(userId: string, id: string, db: Tx | typeof prisma = prisma) {
  const item = await db.budgetItem.findFirst({
    where: { id, category: { budget: { userId } } },
    include: { category: { include: { budget: true } } },
  });
  if (!item) throw notFound("We couldn't find that budget item.");
  return item;
}
