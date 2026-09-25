import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, app, prisma, request, resetDb, signUpAgent } from "../helpers.js";

describe("foundation", () => {
  beforeAll(resetDb);
  afterAll(() => prisma.$disconnect());

  it("rejects unauthenticated API calls with the error envelope", async () => {
    const res = await request(app).get("/api/v1/anything");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: { code: "UNAUTHENTICATED", message: "Please sign in to continue." },
    });
  });

  it("signs up with profile fields and reaches authenticated routes", async () => {
    const { agent, user } = await signUpAgent();
    expect(user.id).toBeTruthy();
    const res = await api(agent).get("/api/v1/unknown");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});
