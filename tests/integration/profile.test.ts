import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ORIGIN, api, app, prisma, request, resetDb, signUpAgent } from "../helpers.js";

describe("US1 — profile (/api/v1/me)", () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it("returns the profile", async () => {
    const { agent, body } = await signUpAgent();
    const res = await api(agent).get("/api/v1/me");
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      username: body.username,
      email: body.email,
      timezone: "America/Bogota",
      themePreference: "SYSTEM",
      onboardingStatus: "PENDING",
    });
    expect(res.body.data.password).toBeUndefined();
  });

  it("updates allowed fields, including timezone and theme", async () => {
    const { agent } = await signUpAgent();
    const res = await api(agent).patch("/api/v1/me", {
      city: "Bogotá",
      timezone: "America/Los_Angeles",
      themePreference: "DARK",
      onboardingStatus: "SKIPPED",
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      city: "Bogotá",
      timezone: "America/Los_Angeles",
      themePreference: "DARK",
    });
  });

  it.each([
    [{ username: "other" }, "username"],
    [{ email: "x@example.com" }, "email"],
    [{ timezone: "Nowhere/City" }, "timezone"],
    [{ onboardingStatus: "PENDING" }, "onboardingStatus"],
  ])("rejects %o", async (body, field) => {
    const { agent } = await signUpAgent();
    const res = await api(agent).patch("/api/v1/me", body);
    expect(res.status).toBe(422);
    expect(res.body.error.fields[field]).toBeTruthy();
  });

  it("changes the email immediately and the new email signs in", async () => {
    const { agent, body } = await signUpAgent();
    const change = await agent
      .post("/api/auth/change-email")
      .set("Origin", ORIGIN)
      .send({ newEmail: "new-address@example.com" });
    expect(change.status).toBe(200);
    expect((await api(agent).get("/api/v1/me")).body.data.email).toBe("new-address@example.com");
    const signIn = await request(app)
      .post("/api/auth/sign-in/email")
      .set("Origin", ORIGIN)
      .send({ email: "new-address@example.com", password: body.password });
    expect(signIn.status).toBe(200);
  });

  it("rejects changing to an email already in use", async () => {
    const other = await signUpAgent();
    const { agent } = await signUpAgent();
    const res = await agent
      .post("/api/auth/change-email")
      .set("Origin", ORIGIN)
      .send({ newEmail: other.body.email });
    expect(res.status).toBe(422);
    expect(res.body.fields.newEmail).toBeTruthy();
  });
});
