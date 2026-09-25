import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "../generated/prisma/client.js";

// One client per function instance; Neon's serverless driver pools over WebSockets.
const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL ?? "" });

export const prisma = new PrismaClient({ adapter });

export type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
