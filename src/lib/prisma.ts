import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "../generated/prisma/client.js";

// One client per function instance; Neon's serverless driver pools over WebSockets.
// Timeouts turn a stuck connection into an error instead of a request that never ends.
const adapter = new PrismaNeon({
  connectionString: process.env.DATABASE_URL ?? "",
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 30_000,
});

export const prisma = new PrismaClient({ adapter });

export type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
