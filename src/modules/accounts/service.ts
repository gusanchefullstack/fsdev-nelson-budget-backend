import type { z } from "zod";
import { recalcAccountBalances } from "../../lib/balances.js";
import { pickContact, referencedMessage } from "../../lib/contact.js";
import { conflict, notFound } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";
import { money } from "../../lib/serialize.js";
import type { createAccountSchema, updateAccountSchema } from "./schemas.js";

type Row = Awaited<ReturnType<typeof prisma.moneyAccount.findFirstOrThrow>> & {
  _count: { transactions: number };
};

const serialize = (a: Row) => ({
  id: a.id,
  name: a.name,
  description: a.description,
  type: a.type,
  currency: a.currency,
  openingBalance: money(a.openingBalance),
  currentBalance: money(a.currentBalance),
  ...pickContact(a),
  transactionCount: a._count.transactions,
  createdAt: a.createdAt,
  updatedAt: a.updatedAt,
});

const include = { _count: { select: { transactions: true } } };

async function owned(userId: string, id: string) {
  const account = await prisma.moneyAccount.findFirst({ where: { id, userId }, include });
  if (!account) throw notFound("We couldn't find that account.");
  return account;
}

export async function listAccounts(userId: string) {
  const rows = await prisma.moneyAccount.findMany({
    where: { userId },
    include,
    orderBy: { name: "asc" },
  });
  return rows.map(serialize);
}

export async function getAccount(userId: string, id: string) {
  return serialize(await owned(userId, id));
}

export async function createAccount(userId: string, data: z.output<typeof createAccountSchema>) {
  const row = await prisma.moneyAccount.create({
    data: { ...data, userId, currentBalance: data.openingBalance },
    include,
  });
  return serialize(row);
}

export async function updateAccount(
  userId: string,
  id: string,
  data: z.output<typeof updateAccountSchema>,
) {
  const account = await owned(userId, id);
  if (data.currency && data.currency !== account.currency && account._count.transactions > 0) {
    throw conflict("The currency can't change once the account has transactions.");
  }
  await prisma.$transaction(async (tx) => {
    await tx.moneyAccount.update({ where: { id }, data });
    if (data.openingBalance !== undefined) await recalcAccountBalances(tx, [id]);
  });
  return serialize(await owned(userId, id));
}

export async function deleteAccount(userId: string, id: string) {
  const account = await owned(userId, id);
  if (account._count.transactions > 0)
    throw conflict(referencedMessage("account", account._count.transactions));
  await prisma.moneyAccount.delete({ where: { id } });
}
