import { describe, it, expect, beforeAll } from "bun:test";
import { walletService } from "./wallet.service";
import { db } from "../../db";
import { assets, wallets, users, ledgerEntries, transactions } from "../../db/schema";
import { sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";

describe("WalletService", () => {
  let assetId: string;
  let user1Id: string;
  let user2Id: string;

  beforeAll(async () => {
    await db.execute(sql`TRUNCATE TABLE ${ledgerEntries}, ${transactions}, ${wallets}, ${users}, ${assets} CASCADE`);

    const [asset] = await db.insert(assets).values({
      slug: "gold_coins",
      name: "Gold Coins",
      decimalPlaces: 0,
    }).returning();
    assetId = asset.id;

    const u1 = await db.insert(users).values({ email: "test1@example.com", username: "testuser1" }).returning();
    user1Id = u1[0].id;

    const u2 = await db.insert(users).values({ email: "test2@example.com", username: "testuser2" }).returning();
    user2Id = u2[0].id;
  });

  it("should create a user wallet", async () => {
    const wallet = await walletService.createWallet({
      userId: user1Id,
      assetSlug: "gold_coins",
      type: "USER",
      initialBalance: 500n,
    });

    expect(wallet.userId).toBe(user1Id);
    expect(wallet.balance).toBe(500n);
    expect(wallet.type).toBe("USER");
  });

  it("should throw error for non-existent asset", async () => {
    expect(walletService.createWallet({
      userId: user1Id,
      assetSlug: "invalid_asset",
      type: "USER",
    })).rejects.toThrow("Asset with slug invalid_asset not found");
  });

  it("should throw error for non-existent user", async () => {
    const fakeUserId = uuidv4();
    expect(walletService.createWallet({
      userId: fakeUserId,
      assetSlug: "gold_coins",
      type: "USER",
    })).rejects.toThrow();
  });

  it("should retrieve a wallet by ID", async () => {
    // Use user2Id to avoid conflict with "should prevent multiple wallets..." test
    const wallet = await walletService.createWallet({
      userId: user2Id,
      assetSlug: "gold_coins",
      type: "USER",
    });

    const retrieved = await walletService.getWallet(wallet.id);
    expect(retrieved.id).toBe(wallet.id);
    expect(retrieved.type).toBe("USER");
  });

  it("should retrieve balance", async () => {
    // Create a NEW user to avoid conflicts
    const [newUser] = await db.insert(users).values({ email: "balance_test@test.com", username: "balancetest" }).returning();
    const wallet = await walletService.createWallet({
      userId: newUser.id,
      assetSlug: "gold_coins",
      type: "USER",
      initialBalance: 123n,
    });

    if (!wallet) throw new Error("Wallet not created");
    const balance = await walletService.getBalance(wallet.id);
    expect(balance).toBe(123n);
  });

  it("should handle concurrent wallet creation safely", async () => {
    const [newUser] = await db.insert(users).values({ email: "concurrent@test.com", username: "concurrent" }).returning();
    const newUserId = newUser.id;
    
    const promises = Array(5).fill(null).map(() => 
      walletService.createWallet({
        userId: newUserId,
        assetSlug: "gold_coins",
        type: "USER",
      }).catch(e => e)
    );

    const results = await Promise.all(promises);
    
    const successes = results.filter(r => !(r instanceof Error));
    const failures = results.filter(r => r instanceof Error);

    expect(successes.length).toBe(1);
    expect(failures.length).toBe(4);
  });
});
