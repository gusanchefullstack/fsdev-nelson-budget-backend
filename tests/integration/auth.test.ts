import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const sent = vi.hoisted(() => [] as { to: string; text: string }[]);
vi.mock("../../src/lib/email.js", () => ({
  sendEmail: async (to: string, _subject: string, text: string) => {
    sent.push({ to, text });
  },
}));

import { ORIGIN, app, prisma, profile, request, resetDb, signUpAgent } from "../helpers.js";

const post = (path: string, body: object, ip = "10.0.0.1") =>
  request(app).post(path).set("Origin", ORIGIN).set("X-Forwarded-For", ip).send(body);

describe("US1 — authentication", () => {
  beforeEach(async () => {
    await resetDb();
    sent.length = 0;
  });
  afterAll(() => prisma.$disconnect());

  it("requires every mandatory profile field on sign-up", async () => {
    const body: Record<string, unknown> = profile();
    delete body.city;
    const res = await post("/api/auth/sign-up/email", body);
    expect(res.status).toBe(422);
    expect(res.body.fields.city).toBeTruthy();
  });

  it.each([
    ["country", "USA"],
    ["phoneCountryCode", "1"],
    ["phoneNumber", "12"],
    ["timezone", "Mars/Olympus"],
    ["username", "no spaces"],
  ])("rejects an invalid %s", async (field, value) => {
    const res = await post("/api/auth/sign-up/email", profile({ [field]: value }));
    expect(res.status).toBe(422);
    expect(res.body.fields[field]).toBeTruthy();
  });

  it("rejects a duplicate username or email", async () => {
    const { body } = await signUpAgent();
    const dupUser = await post("/api/auth/sign-up/email", profile({ username: body.username }));
    expect(dupUser.status).toBe(422);
    expect(dupUser.body.fields.username).toBeTruthy();
    const dupEmail = await post("/api/auth/sign-up/email", profile({ email: body.email }));
    expect(dupEmail.status).toBe(422);
    expect(dupEmail.body.fields.email).toBeTruthy();
  });

  it("signs in by username and by email, and signs out", async () => {
    const { body } = await signUpAgent();
    const byUsername = await post("/api/auth/sign-in/username", {
      username: body.username,
      password: body.password,
    });
    expect(byUsername.status).toBe(200);
    const agent = request.agent(app);
    const byEmail = await agent
      .post("/api/auth/sign-in/email")
      .set("Origin", ORIGIN)
      .send({ email: body.email, password: body.password });
    expect(byEmail.status).toBe(200);
    expect((await agent.get("/api/v1/me")).status).toBe(200);
    await agent.post("/api/auth/sign-out").set("Origin", ORIGIN).send({});
    expect((await agent.get("/api/v1/me")).status).toBe(401);
  });

  it("answers a wrong password with a generic 401", async () => {
    const { body } = await signUpAgent();
    const res = await post("/api/auth/sign-in/email", {
      email: body.email,
      password: "wrong-password",
    });
    expect(res.status).toBe(401);
  });

  it("gives the same answer to reset requests for known and unknown emails", async () => {
    const { body } = await signUpAgent();
    const known = await post("/api/auth/request-password-reset", {
      email: body.email,
      redirectTo: `${ORIGIN}/reset-password`,
    });
    const unknown = await post("/api/auth/request-password-reset", {
      email: "nobody@example.com",
      redirectTo: `${ORIGIN}/reset-password`,
    });
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(unknown.body).toEqual(known.body);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe(body.email);
  });

  it("resets the password once with the emailed link", async () => {
    const { body } = await signUpAgent();
    await post("/api/auth/request-password-reset", {
      email: body.email,
      redirectTo: `${ORIGIN}/reset-password`,
    });
    const token = /token=([\w-]+)/.exec(sent[0]!.text)?.[1];
    expect(token).toBeTruthy();

    const reset = await post("/api/auth/reset-password", {
      token,
      newPassword: "brand-new-pass-2",
    });
    expect(reset.status).toBe(200);
    const again = await post("/api/auth/reset-password", { token, newPassword: "another-pass-3" });
    expect(again.status).toBe(400);

    const signIn = await post("/api/auth/sign-in/email", {
      email: body.email,
      password: "brand-new-pass-2",
    });
    expect(signIn.status).toBe(200);
  });

  it("rejects a reset link older than 1 hour", async () => {
    const { body } = await signUpAgent();
    await post("/api/auth/request-password-reset", {
      email: body.email,
      redirectTo: `${ORIGIN}/reset-password`,
    });
    const token = /token=([\w-]+)/.exec(sent[0]!.text)?.[1];
    const tokens = await prisma.verification.findMany();
    expect(tokens).toHaveLength(1);
    const lifetime = tokens[0]!.expiresAt.getTime() - tokens[0]!.createdAt.getTime();
    expect(Math.round(lifetime / 60000)).toBe(60);
    await prisma.verification.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await post("/api/auth/reset-password", { token, newPassword: "brand-new-pass-2" });
    expect(res.status).toBe(400);
  });
});
