import { Router } from "express";
import { z } from "zod";
import { pickContact, referencedMessage } from "../../lib/contact.js";
import { conflict, notFound } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";
import { currentUser } from "../../lib/session.js";
import { currency, description500, name80, optionalContact, validate } from "../../lib/validate.js";

type Kind = {
  model: "payor" | "vendor";
  path: string;
  noun: string;
  types: readonly [string, ...string[]];
};

type Row = {
  id: string;
  name: string;
  description: string | null;
  type: string;
  currency: string;
  createdAt: Date;
  updatedAt: Date;
  _count: { transactions: number };
};

/** Payors and vendors share the same shape and rules (FR-031, FR-032). */
export function counterpartyRouter({ model, path, noun, types }: Kind) {
  const createSchema = z.object({
    name: name80,
    description: description500.nullish(),
    type: z.enum(types, "Choose a type."),
    currency,
    ...optionalContact,
  });
  const updateSchema = createSchema.partial();
  // The two Prisma delegates have identical signatures for what is used here.
  const db = prisma[model] as unknown as typeof prisma.payor;
  const include = { _count: { select: { transactions: true } } };
  const serialize = (r: Row) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    type: r.type,
    currency: r.currency,
    ...pickContact(r as unknown as Record<string, unknown>),
    transactionCount: r._count.transactions,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  });
  async function owned(userId: string, id: string) {
    const row = await db.findFirst({ where: { id, userId }, include });
    if (!row) throw notFound(`We couldn't find that ${noun}.`);
    return row as unknown as Row;
  }

  const router = Router();
  router.get(`/${path}`, async (_req, res) => {
    const rows = await db.findMany({
      where: { userId: currentUser(res).id },
      include,
      orderBy: { name: "asc" },
    });
    res.json({ data: (rows as unknown as Row[]).map(serialize) });
  });
  router.post(`/${path}`, validate(createSchema), async (_req, res) => {
    const row = await db.create({
      data: { ...res.locals.body, userId: currentUser(res).id },
      include,
    });
    res.status(201).json({ data: serialize(row as unknown as Row) });
  });
  router.get(`/${path}/:id`, async (req, res) => {
    res.json({ data: serialize(await owned(currentUser(res).id, String(req.params.id))) });
  });
  router.patch(`/${path}/:id`, validate(updateSchema), async (req, res) => {
    const id = String(req.params.id);
    await owned(currentUser(res).id, id);
    const row = await db.update({ where: { id }, data: res.locals.body, include });
    res.json({ data: serialize(row as unknown as Row) });
  });
  router.delete(`/${path}/:id`, async (req, res) => {
    const row = await owned(currentUser(res).id, String(req.params.id));
    if (row._count.transactions > 0)
      throw conflict(referencedMessage(noun, row._count.transactions));
    await db.delete({ where: { id: row.id } });
    res.status(204).end();
  });
  return router;
}
