import { describe, it, expect, beforeAll } from "bun:test";
import { db } from "../../db";
import { assets, wallets, users, ledgerEntries, transactions } from "../../db/schema";
import { sql, eq } from "drizzle-orm";
import { transactionService, TransferParams } from "./transaction.service";
import { walletService } from "../wallets/wallet.service";

describe("Transaction Service - Comprehensive Integrity Tests", () => {
  let user1WalletId: string;
  let user2WalletId: string;
  let systemWalletId: string;
  let assetId: string;
  let user1Id: string;
  let user2Id: string;

  beforeAll(async () => {
    await db.execute(sql`TRUNCATE TABLE ${ledgerEntries}, ${transactions}, ${wallets}, ${users}, ${assets} CASCADE`);

    const [asset] = await db.insert(assets).values({ slug: "platinum", name: "Platinum", decimalPlaces: 0 }).returning();
    assetId = asset.id;

    const [u1] = await db.insert(users).values({ email: "t1@test.com", username: "t1" }).returning();
    const [u2] = await db.insert(users).values({ email: "t2@test.com", username: "t2" }).returning();
    const [sys] = await db.insert(users).values({ email: "system@test.com", username: "system" }).returning();

    user1Id = u1.id;
    user2Id = u2.id;

    user1WalletId = (await walletService.createWallet({ userId: u1.id, assetSlug: "platinum", type: "USER", initialBalance: 1000n })).id;
    user2WalletId = (await walletService.createWallet({ userId: u2.id, assetSlug: "platinum", type: "USER", initialBalance: 500n })).id;
    systemWalletId = (await walletService.createWallet({ assetSlug: "platinum", type: "SYSTEM", initialBalance: 1000000n })).id;
  });

  // --- Edge Case 1: Parameter Mismatch Idempotency (CRITICAL) ---
  it("should reject idempotent request if parameters differ from original transaction", async () => {
    const idempotencyKey = "param-mismatch-test-1";

    // First request: Send 100
    await transactionService.transfer({
      fromWalletId: user1WalletId,
      toWalletId: user2WalletId,
      amount: 100n,
      type: "SPEND",
      idempotencyKey,
    });

    // Second request: Same key, but try to send 999 (should fail)
    await expect(transactionService.transfer({
      fromWalletId: user1WalletId,
      toWalletId: user2WalletId,
      amount: 999n, // DIFFERENT AMOUNT
      type: "SPEND",
      idempotencyKey,
    })).rejects.toThrow(/Idempotency key mismatch|Parameters differ/);
  });

  // --- Edge Case 2: Parameter Mismatch (Source Wallet) ---
  it("should reject if idempotent key is used with different source wallet", async () => {
    const idempotencyKey = "param-mismatch-source";

    await transactionService.transfer({
      fromWalletId: user1WalletId,
      toWalletId: user2WalletId,
      amount: 50n,
      type: "SPEND",
      idempotencyKey,
    });

    // Try to use same key but from a different wallet
    await expect(transactionService.transfer({
      fromWalletId: systemWalletId, // DIFFERENT SOURCE
      toWalletId: user2WalletId,
      amount: 50n,
      type: "BONUS",
      idempotencyKey,
    })).rejects.toThrow(/Idempotency key mismatch|Parameters differ/);
  });

  // --- Edge Case 3: Asset Mismatch ---
  it("should prevent transferring between wallets of different assets", async () => {
    // Create a diamond wallet for user 1
    const [diamondAsset] = await db.insert(assets).values({ slug: "test_diamonds", name: "Test Diamonds", decimalPlaces: 0 }).returning();
    const diamondWalletId = (await walletService.createWallet({ userId: user1Id, assetSlug: "test_diamonds", type: "USER", initialBalance: 100n })).id;
    
    // Try to transfer from Gold wallet to Diamond wallet
    await expect(transactionService.transfer({
      fromWalletId: user1WalletId, // Gold
      toWalletId: diamondWalletId, // Diamonds
      amount: 10n,
      type: "SPEND",
      idempotencyKey: `asset-mismatch-${Date.now()}`,
    })).rejects.toThrow(/Asset mismatch|Asset types must match/);
  });

  // --- Edge Case 4: Self-Transfer ---
  it("should prevent transferring funds to the same wallet", async () => {
    await expect(transactionService.transfer({
      fromWalletId: user1WalletId,
      toWalletId: user1WalletId, // Same wallet
      amount: 10n,
      type: "SPEND",
      idempotencyKey: `self-transfer-${Date.now()}`,
    })).rejects.toThrow(/Source and destination.*must be different/);
  });

  // --- Edge Case 5: Zero Amount ---
  it("should reject transactions with zero or negative amounts", async () => {
    await expect(transactionService.transfer({
      fromWalletId: user1WalletId,
      toWalletId: user2WalletId,
      amount: 0n,
      type: "SPEND",
      idempotencyKey: `zero-amount-${Date.now()}`,
    })).rejects.toThrow(/Amount must be greater than zero/);
  });

  // --- Edge Case 6: Insufficient Funds (User Wallet) ---
  it("should reject spend if user has insufficient funds", async () => {
    await expect(transactionService.transfer({
      fromWalletId: user2WalletId, // Has 500
      toWalletId: systemWalletId,
      amount: 1000n, // Wants to spend 1000
      type: "SPEND",
      idempotencyKey: `insufficient-${Date.now()}`,
    })).rejects.toThrow(/Insufficient funds/);
  });

  // --- Edge Case 7: System Wallet Debit Check ---
  it("should allow system wallet to be debited (spend) but not below zero if constrained", async () => {
    // Create a NEW system wallet with exactly 10 using a NEW asset
    const [newAsset] = await db.insert(assets).values({ slug: `sys_test_asset_${Date.now()}`, name: "Sys Test Asset", decimalPlaces: 0 }).returning();
    const sysW = (await walletService.createWallet({ assetSlug: newAsset.slug, type: "SYSTEM", initialBalance: 10n })).id;

    // Try to spend more than 10
    await expect(transactionService.transfer({
      fromWalletId: sysW, 
      toWalletId: user1WalletId,
      amount: 20n,
      type: "SPEND",
      idempotencyKey: `sys-spend-${Date.now()}`,
    })).rejects.toThrow(/Insufficient funds/);
  });

  // --- Edge Case 8: Ledger Balance Check (Audit Integrity) ---
  it("should ensure ledger entries always balance to zero", async () => {
    const testAmount = 77n;
    const key = `ledger-check-${Date.now()}`;

    await transactionService.transfer({
      fromWalletId: user1WalletId,
      toWalletId: user2WalletId,
      amount: testAmount,
      type: "SPEND",
      idempotencyKey: key,
    });

    // Find the transaction
    const tx = await db.query.transactions.findFirst({
      where: (transactions, { eq }) => eq(transactions.idempotencyKey, key),
    });

    // Get ledger entries
    const entries = await db.query.ledgerEntries.findMany({
      where: (ledgerEntries, { eq }) => eq(ledgerEntries.transactionId, tx!.id),
    });

    expect(entries.length).toBe(2);
    
    const debit = entries.find(e => e.direction === "DEBIT");
    const credit = entries.find(e => e.direction === "CREDIT");

    expect(debit!.amount).toBe(testAmount);
    expect(credit!.amount).toBe(testAmount);
  });

  // --- Edge Case 9: Concurrent High-Volume Transfers (Stress Test) ---
  it("should handle 100 concurrent transfers from one user to another accurately", async () => {
    const amount = 1n;
    const count = 100;
    const startBalance = (await walletService.getBalance(user1WalletId));

    const promises = [];
    for (let i = 0; i < count; i++) {
      promises.push(transactionService.transfer({
        fromWalletId: user1WalletId,
        toWalletId: user2WalletId,
        amount,
        type: "SPEND",
        idempotencyKey: `concurrent-stress-${i}`,
      }));
    }

    await Promise.all(promises);

    const endBalance = await walletService.getBalance(user1WalletId);
    expect(endBalance).toBe(startBalance - BigInt(count));
  });
});
