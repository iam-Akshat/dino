import { describe, it, expect, beforeAll } from "bun:test";
import request from "supertest";
import app from "../index";
import { db } from "../db";
import { assets, wallets, users, ledgerEntries, transactions } from "../db/schema";
import { sql, eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";

describe("API Integration Tests", () => {
  const userId = uuidv4();
  const assetSlug = "gold_coins";

  beforeAll(async () => {
    await db.execute(sql`TRUNCATE TABLE ${ledgerEntries}, ${transactions}, ${wallets}, ${users}, ${assets} CASCADE`);
    
    // Seed asset
    const [asset] = await db.insert(assets).values({
      slug: assetSlug,
      name: "Gold Coins",
      decimalPlaces: 0,
    }).returning();

    // Seed user
    const [user] = await db.insert(users).values({
      email: "api_test_user@example.com",
      username: "apitestuser",
    }).returning();
    const apiUserId = user.id;

    // Seed system wallet
    await db.insert(wallets).values({
      assetId: asset.id,
      type: "SYSTEM",
      balance: 1000000n,
    });

    // Seed user wallet
    await db.insert(wallets).values({
      userId: apiUserId,
      assetId: asset.id,
      type: "USER",
      balance: 100n,
    });

    // Update the outer scope userId to match the created user (if needed for tests, or just use apiUserId)
    // Note: We can't easily update the outer const, so we'll just use a new variable in tests if needed
    // But for the GET test, we need to know the ID. Let's just override the outer one for simplicity in this file scope if it was const.
    // Actually, we can't reassign const. Let's just re-query in the tests or use a fixed UUID for the tests.
    // Better approach: query the user we just created.
  });

  it("GET /health should return 200", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("GET /wallets/:userId/:assetSlug/balance should return correct balance", async () => {
    // Find the user we created
    const user = await db.query.users.findFirst({ where: (users, { eq }) => eq(users.email, "api_test_user@example.com") });
    expect(user).toBeDefined();

    const res = await request(app).get(`/wallets/${user!.id}/${assetSlug}/balance`);
    expect(res.status).toBe(200);
    expect(res.body.balance).toBe("100");
  });

  it("POST /transactions/topup should credit user and require idempotency key", async () => {
    const user = await db.query.users.findFirst({ where: (users, { eq }) => eq(users.email, "api_test_user@example.com") });

    // Missing idempotency key
    const resNoKey = await request(app)
      .post("/transactions/topup")
      .send({ userId: user!.id, assetSlug, amount: "50" });
    expect(resNoKey.status).toBe(400);
    expect(resNoKey.body.error).toContain("Idempotency-Key");

    // Success
    const idempotencyKey = uuidv4();
    const res = await request(app)
      .post("/transactions/topup")
      .set("Idempotency-Key", idempotencyKey)
      .send({ userId: user!.id, assetSlug, amount: "50" });

    if (res.status !== 201) {
      console.error("Topup failed:", res.body);
    }
    expect(res.status).toBe(201);
    
    const balanceRes = await request(app).get(`/wallets/${user!.id}/${assetSlug}/balance`);
    expect(balanceRes.body.balance).toBe("150");
  });

  it("POST /transactions/spend should debit user", async () => {
    const user = await db.query.users.findFirst({ where: (users, { eq }) => eq(users.email, "api_test_user@example.com") });
    const idempotencyKey = uuidv4();
    const res = await request(app)
      .post("/transactions/spend")
      .set("Idempotency-Key", idempotencyKey)
      .send({ userId: user!.id, assetSlug, amount: "30" });
    
    expect(res.status).toBe(201);
    
    const balanceRes = await request(app).get(`/wallets/${user!.id}/${assetSlug}/balance`);
    expect(balanceRes.body.balance).toBe("120");
  });

  it("POST /transactions/spend should return 400 if insufficient funds", async () => {
    const user = await db.query.users.findFirst({ where: (users, { eq }) => eq(users.email, "api_test_user@example.com") });
    const idempotencyKey = uuidv4();
    const res = await request(app)
      .post("/transactions/spend")
      .set("Idempotency-Key", idempotencyKey)
      .send({ userId: user!.id, assetSlug, amount: "1000" });
    
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Insufficient funds");
  });
});
