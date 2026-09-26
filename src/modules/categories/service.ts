import type { z } from "zod";
import { conflict } from "../../lib/errors.js";
import { recalcAccountBalances } from "../../lib/balances.js";
import { ownedBudget, ownedCategory } from "../../lib/ownership.js";
import { prisma } from "../../lib/prisma.js";
import type { createCategorySchema, updateCategorySchema } from "./schemas.js";

const serialize = (c: {
  id: string;
  budgetId: string;
  type: string;
  name: string;
  description: string | null;
}) => ({
  id: c.id,
  budgetId: c.budgetId,
  type: c.type,
  name: c.name,
  description: c.description,
});

export async function createCategory(
  userId: string,
  budgetId: string,
  data: z.output<typeof createCategorySchema>,
) {
  await ownedBudget(userId, budgetId);
  return serialize(await prisma.category.create({ data: { ...data, budgetId } }));
}

export async function updateCategory(
  userId: string,
  id: string,
  data: z.output<typeof updateCategorySchema>,
) {
  const category = await ownedCategory(userId, id);
  if (
    data.type &&
    data.type !== category.type &&
    (await prisma.budgetItem.count({ where: { categoryId: id } })) > 0
  ) {
    throw conflict("The type can't change once the category has items.");
  }
  return serialize(await prisma.category.update({ where: { id }, data }));
}

export async function deleteCategory(userId: string, id: string) {
  await ownedCategory(userId, id);
  await prisma.$transaction(async (tx) => {
    const accounts = await tx.transaction.findMany({
      where: { item: { categoryId: id } },
      select: { accountId: true },
      distinct: ["accountId"],
    });
    await tx.category.delete({ where: { id } });
    await recalcAccountBalances(
      tx,
      accounts.map((a) => a.accountId),
    );
  });
}
