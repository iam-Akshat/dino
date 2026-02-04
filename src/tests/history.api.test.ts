import { describe, it, expect, beforeAll } from "bun:test";
import request from "supertest";
import app from "../index";
import { db } from "../db";
import { assets, wallets, users, ledgerEntries, transactions } from "../db/schema";
import { sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";

describe("Wallet History API Tests", () => {
  let walletId: string;
  let assetId: string;
  const assetSlug = "history_test_coin";

  beforeAll(async () => {
    // Clean up
    await db.execute(sql`TRUNCATE TABLE ${ledgerEntries}, ${transactions}, ${wallets}, ${users}, ${assets} CASCADE`);

    // Seed data
    const assetsResult = await db.insert(assets).values({
      slug: assetSlug,
      name: "History Test Coin",
      decimalPlaces: 2,
    }).returning();
    const asset = assetsResult[0];
    if (!asset) throw new Error("Failed to seed asset");
    assetId = asset.id;

    const usersResult = await db.insert(users).values({
      email: "history_test@example.com",
      username: "historytester",
    }).returning();
    const user = usersResult[0];
    if (!user) throw new Error("Failed to seed user");

    const walletsResult = await db.insert(wallets).values({
      userId: user.id,
      assetId: asset.id,
      type: "USER",
      balance: 1000n,
    }).returning();
    const wallet = walletsResult[0];
    if (!wallet) throw new Error("Failed to seed wallet");
    walletId = wallet.id;

    // Seed 15 transactions to test pagination (limit 10)
    for (let i = 0; i < 15; i++) {
      const txId = uuidv4();
      const transactionsResult = await db.insert(transactions).values({
        id: txId,
        idempotencyKey: `key-${i}`,
        type: i % 2 === 0 ? "TOPUP" : "SPEND",
        assetId: asset.id,
        fromWalletId: i % 2 === 0 ? null : walletId,
        toWalletId: i % 2 === 0 ? walletId : null,
        amount: BigInt(10 + i),
        metadata: `Test transaction ${i}`,
      }).returning();
      const transaction = transactionsResult[0];
      if (!transaction) throw new Error("Failed to seed transaction");

      await db.insert(ledgerEntries).values({
        transactionId: transaction.id,
        walletId: walletId,
        amount: BigInt(10 + i),
        direction: i % 2 === 0 ? "CREDIT" : "DEBIT",
      });
    }
  });

  it("should fetch the first page of history (default limit)", async () => {
    const res = await request(app).get(`/wallets/${walletId}/history`);
    
    expect(res.status).toBe(200);
    expect(res.body.data).toBeInstanceOf(Array);
    expect(res.body.data.length).toBe(10); // Default limit is 10
    expect(res.body.pagination).toBeDefined();
  });

  it("should respect the limit parameter", async () => {
    const limit = 5;
    const res = await request(app).get(`/wallets/${walletId}/history?limit=${limit}`);
    
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(limit);
    expect(res.body.pagination.nextCursor).toBeDefined();
    expect(res.body.pagination.nextCursor).not.toBeNull();
  });

  it("should paginate correctly using the cursor", async () => {
    // Page 1
    const limit = 10;
    const res1 = await request(app).get(`/wallets/${walletId}/history?limit=${limit}`);
    expect(res1.body.data.length).toBe(10);
    const nextCursor = res1.body.pagination.nextCursor;
    expect(nextCursor).not.toBeNull();

    // Page 2
    const res2 = await request(app).get(`/wallets/${walletId}/history?limit=${limit}&cursor=${nextCursor}`);
    expect(res2.body.data.length).toBe(5); // 15 total - 10 first page = 5
    expect(res2.body.pagination.nextCursor).toBeNull();

    // Verify ordering (newest first)
    const firstPageLastDate = new Date(res1.body.data[9].createdAt).getTime();
    const secondPageFirstDate = new Date(res2.body.data[0].createdAt).getTime();
    expect(firstPageLastDate).toBeGreaterThanOrEqual(secondPageFirstDate);
  });

  it("should return 404 for a non-existent wallet", async () => {
    const fakeId = uuidv4();
    const res = await request(app).get(`/wallets/${fakeId}/history`);
    expect(res.status).toBe(404);
  });

  it("should return an empty list for a wallet with no history", async () => {
    // Create a new wallet with no transactions
    const walletsResult = await db.insert(wallets).values({
      assetId: assetId,
      type: "USER",
      balance: 0n,
    }).returning();
    const newWallet = walletsResult[0];
    if (!newWallet) throw new Error("Failed to create new wallet");

    const res = await request(app).get(`/wallets/${newWallet.id}/history`);
    expect(res.status).toBe(200);
    expect(res.body.data).toBeInstanceOf(Array);
    expect(res.body.data.length).toBe(0);
    expect(res.body.pagination.nextCursor).toBeNull();
  });
});
