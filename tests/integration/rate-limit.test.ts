import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/email.js", () => ({ sendEmail: async () => {} }));

import { ORIGIN, app, prisma, profile, request, resetDb, signUpAgent } from "../helpers.js";

const post = (path: string, body: object, ip: string) =>
  request(app).post(path).set("Origin", ORIGIN).set("X-Forwarded-For", ip).send(body);

describe("US1 — rate limits (FR-005a)", () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it("locks an account after 5 failures, from any IP, counting username and email together", async () => {
    const { body } = await signUpAgent();
    for (let i = 0; i < 5; i++) {
      const res =
        i % 2 === 0
          ? await post(
              "/api/auth/sign-in/email",
              { email: body.email, password: "nope-nope" },
              `10.1.0.${i}`,
            )
          : await post(
              "/api/auth/sign-in/username",
              { username: body.username, password: "nope-nope" },
              `10.1.0.${i}`,
            );
      expect(res.status).toBe(401);
    }
    const blocked = await post(
      "/api/auth/sign-in/email",
      { email: body.email, password: body.password },
      "10.1.0.99",
    );
    expect(blocked.status).toBe(429);
  });

  it("locks an IP after 5 failures across different accounts", async () => {
    for (let i = 0; i < 5; i++) {
      const res = await post(
        "/api/auth/sign-in/email",
        { email: `ghost${i}@example.com`, password: "nope-nope" },
        "10.2.0.1",
      );
      expect(res.status).toBe(401);
    }
    const { body } = await signUpAgent();
    const blocked = await post(
      "/api/auth/sign-in/email",
      { email: body.email, password: body.password },
      "10.2.0.1",
    );
    expect(blocked.status).toBe(429);
  });

  it("lifts the lock 15 minutes after the 5th failure", async () => {
    const { body } = await signUpAgent();
    for (let i = 0; i < 5; i++) {
      await post(
        "/api/auth/sign-in/email",
        { email: body.email, password: "nope-nope" },
        "10.3.0.1",
      );
    }
    const past = BigInt(Date.now() - 15 * 60 * 1000 - 1000);
    await prisma.rateLimit.updateMany({
      where: { key: { startsWith: "signin-fail:" } },
      data: { lastRequest: past },
    });
    const ok = await post(
      "/api/auth/sign-in/email",
      { email: body.email, password: body.password },
      "10.3.0.1",
    );
    expect(ok.status).toBe(200);
  });

  it("clears the account counter after a successful sign-in", async () => {
    const { body } = await signUpAgent();
    for (let i = 0; i < 4; i++) {
      await post(
        "/api/auth/sign-in/email",
        { email: body.email, password: "nope-nope" },
        `10.4.0.${i}`,
      );
    }
    expect(
      (
        await post(
          "/api/auth/sign-in/email",
          { email: body.email, password: body.password },
          "10.4.1.1",
        )
      ).status,
    ).toBe(200);
    for (let i = 0; i < 4; i++) {
      await post(
        "/api/auth/sign-in/email",
        { email: body.email, password: "nope-nope" },
        `10.4.2.${i}`,
      );
    }
    expect(
      (
        await post(
          "/api/auth/sign-in/email",
          { email: body.email, password: body.password },
          "10.4.3.1",
        )
      ).status,
    ).toBe(200);
  });

  it("allows 5 sign-ups per hour per IP", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await post("/api/auth/sign-up/email", profile(), "10.5.0.1")).status).toBe(200);
    }
    expect((await post("/api/auth/sign-up/email", profile(), "10.5.0.1")).status).toBe(429);
  });

  it("allows 5 password-reset requests per hour per IP", async () => {
    for (let i = 0; i < 5; i++) {
      const res = await post(
        "/api/auth/request-password-reset",
        { email: `x${i}@example.com`, redirectTo: `${ORIGIN}/reset-password` },
        "10.6.0.1",
      );
      expect(res.status).toBe(200);
    }
    const res = await post(
      "/api/auth/request-password-reset",
      { email: "y@example.com", redirectTo: `${ORIGIN}/reset-password` },
      "10.6.0.1",
    );
    expect(res.status).toBe(429);
  });
});
