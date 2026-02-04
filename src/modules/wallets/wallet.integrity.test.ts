import { describe, it, expect, beforeAll } from "bun:test";
import { db } from "../../db";
import { assets, wallets, users, ledgerEntries, transactions } from "../../db/schema";
import { sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { walletService } from "./wallet.service";

describe("Wallet Service - Comprehensive Integrity Tests", () => {
  let assetGoldId: string;
  let assetDiamondId: string;
  let userId1: string;
  let userId2: string;

  beforeAll(async () => {
    await db.execute(sql`TRUNCATE TABLE ${ledgerEntries}, ${transactions}, ${wallets}, ${users}, ${assets} CASCADE`);

    // Setup assets
    const goldRes = await db.insert(assets).values({ slug: "gold_coins", name: "Gold Coins", decimalPlaces: 0 }).returning();
    assetGoldId = goldRes[0].id;

    const diamRes = await db.insert(assets).values({ slug: "diamonds", name: "Diamonds", decimalPlaces: 0 }).returning();
    assetDiamondId = diamRes[0].id;

    // Setup users
    const u1Res = await db.insert(users).values({ email: "user1@test.com", username: "user1" }).returning();
    userId1 = u1Res[0].id;

    const u2Res = await db.insert(users).values({ email: "user2@test.com", username: "user2" }).returning();
    userId2 = u2Res[0].id;
  });

  // --- Edge Case 1: User Existence Enforcement ---
  it("should reject creating a wallet for a non-existent user", async () => {
    const fakeUserId = uuidv4();
    await expect(walletService.createWallet({
      userId: fakeUserId,
      assetSlug: "gold_coins",
      type: "USER",
    })).rejects.toThrow();
  });

  // --- Edge Case 2: Asset Existence Enforcement ---
  it("should reject creating a wallet for a non-existent asset", async () => {
    await expect(walletService.createWallet({
      userId: userId1,
      assetSlug: "non_existent_currency",
      type: "USER",
    })).rejects.toThrow();
  });

  // --- Edge Case 3: Duplicate Wallet Prevention (Same User, Same Asset) ---
  it("should prevent multiple wallets for the same user and asset combination", async () => {
    await walletService.createWallet({
      userId: userId1,
      assetSlug: "gold_coins",
      type: "USER",
    });

    await expect(walletService.createWallet({
      userId: userId1,
      assetSlug: "gold_coins",
      type: "USER",
    })).rejects.toThrow();
  });

  // --- Edge Case 4: Multiple Assets Allowed ---
  it("should allow user to have wallets in different assets", async () => {
    const goldWallet = await walletService.createWallet({
      userId: userId2,
      assetSlug: "gold_coins",
      type: "USER",
    });

    const diamondWallet = await walletService.createWallet({
      userId: userId2,
      assetSlug: "diamonds",
      type: "USER",
    });

    expect(goldWallet.id).not.toBe(diamondWallet.id);
    expect(goldWallet.assetId).not.toBe(diamondWallet.assetId);
  });

  // --- Edge Case 5: System Wallet Unique Constraint ---
  it("should allow only one system wallet per asset", async () => {
    await walletService.createWallet({
      assetSlug: "gold_coins",
      type: "SYSTEM",
    });

    await expect(walletService.createWallet({
      assetSlug: "gold_coins",
      type: "SYSTEM",
    })).rejects.toThrow();
  });

  // --- Edge Case 6: Concurrent Wallet Creation ---
  it("should handle concurrent wallet creation for the same user/asset safely", async () => {
    const [newUser] = await db.insert(users).values({ email: "concurrent@test.com", username: "concurrent" }).returning();
    const newUserId = newUser.id;
    
    const promises = Array(5).fill(null).map(() => 
      walletService.createWallet({
        userId: newUserId,
        assetSlug: "diamonds",
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
