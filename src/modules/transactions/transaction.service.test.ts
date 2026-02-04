import { describe, it, expect, beforeAll } from "bun:test";
import { db } from "../../db";
import { assets, wallets, users, ledgerEntries, transactions } from "../../db/schema";
import { sql, eq } from "drizzle-orm";
import { transactionService, TransferParams } from "./transaction.service";
import { walletService } from "../wallets/wallet.service";

describe("TransactionService", () => {
  let user1WalletId: string;
  let user2WalletId: string;
  let systemWalletId: string;
  let assetId: string;

  beforeAll(async () => {
    await db.execute(sql`TRUNCATE TABLE ${ledgerEntries}, ${transactions}, ${wallets}, ${users}, ${assets} CASCADE`);

    const [asset] = await db.insert(assets).values({ slug: "gold_coins", name: "Gold Coins", decimalPlaces: 0 }).returning();
    assetId = asset.id;

    const [u1] = await db.insert(users).values({ email: "t1@test.com", username: "t1" }).returning();
    const [u2] = await db.insert(users).values({ email: "t2@test.com", username: "t2" }).returning();
    const [sys] = await db.insert(users).values({ email: "system@test.com", username: "system" }).returning();

    user1WalletId = (await walletService.createWallet({ userId: u1.id, assetSlug: "gold_coins", type: "USER", initialBalance: 100n })).id;
    user2WalletId = (await walletService.createWallet({ userId: u2.id, assetSlug: "gold_coins", type: "USER", initialBalance: 50n })).id;
    systemWalletId = (await walletService.createWallet({ assetSlug: "gold_coins", type: "SYSTEM", initialBalance: 1000000n })).id;
  });

  it("should transfer funds successfully", async () => {
    const idempotencyKey = "test-transfer-1";
    await transactionService.transfer({
      fromWalletId: user1WalletId,
      toWalletId: user2WalletId,
      amount: 30n,
      type: "SPEND",
      idempotencyKey,
    });

    const b1 = await walletService.getBalance(user1WalletId);
    const b2 = await walletService.getBalance(user2WalletId);

    expect(b1).toBe(70n);
    expect(b2).toBe(80n);
  });

  it("should be idempotent", async () => {
    const idempotencyKey = "test-transfer-idempotent";
    
    await transactionService.transfer({
      fromWalletId: user1WalletId,
      toWalletId: user2WalletId,
      amount: 10n,
      type: "SPEND",
      idempotencyKey,
    });

    const b1_after1 = await walletService.getBalance(user1WalletId);

    await transactionService.transfer({
      fromWalletId: user1WalletId,
      toWalletId: user2WalletId,
      amount: 10n,
      type: "SPEND",
      idempotencyKey,
    });

    const b1_after2 = await walletService.getBalance(user1WalletId);
    expect(b1_after1).toBe(b1_after2);
  });

  it("should prevent insufficient funds", async () => {
    const idempotencyKey = "test-insufficient";
    
    expect(transactionService.transfer({
      fromWalletId: user1WalletId,
      toWalletId: user2WalletId,
      amount: 1000n,
      type: "SPEND",
      idempotencyKey,
    })).rejects.toThrow("Insufficient funds");
  });

  it("should handle high concurrent transfers safely", async () => {
    const amount = 1n;
    const count = 100;
    const promises = [];

    await db.update(wallets).set({ balance: 200n }).where(eq(wallets.id, user1WalletId));

    for (let i = 0; i < count; i++) {
      promises.push(transactionService.transfer({
        fromWalletId: user1WalletId,
        toWalletId: user2WalletId,
        amount,
        type: "SPEND",
        idempotencyKey: `high-concurrent-${i}`,
      }));
    }

    await Promise.all(promises);

    const b1 = await walletService.getBalance(user1WalletId);
    expect(b1).toBe(100n); // 200 - 100 = 100
  });

  it("should reject idempotent request if amount differs", async () => {
    const key = "idempotent-mismatch-amount";
    
    await transactionService.transfer({
      fromWalletId: user1WalletId,
      toWalletId: user2WalletId,
      amount: 10n,
      type: "SPEND",
      idempotencyKey: key,
    });

    await expect(transactionService.transfer({
      fromWalletId: user1WalletId,
      toWalletId: user2WalletId,
      amount: 50n, 
      type: "SPEND",
      idempotencyKey: key,
    })).rejects.toThrow(/Idempotency key mismatch/);
  });

  it("should reject if idempotent key is used with different destination", async () => {
    const key = "idempotent-mismatch-dest";
    const [tempUser] = await db.insert(users).values({ email: "temp@test.com", username: "temp" }).returning();
    const tempWallet = (await walletService.createWallet({ userId: tempUser.id, assetSlug: "gold_coins", type: "USER", initialBalance: 1000n })).id;

    await transactionService.transfer({
      fromWalletId: user1WalletId,
      toWalletId: user2WalletId,
      amount: 10n,
      type: "SPEND",
      idempotencyKey: key,
    });

    await expect(transactionService.transfer({
      fromWalletId: user1WalletId,
      toWalletId: tempWallet, 
      amount: 10n,
      type: "SPEND",
      idempotencyKey: key,
    })).rejects.toThrow(/Idempotency key mismatch/);
  });

  it("should fail if system wallet is debited below zero", async () => {
    const [newAsset] = await db.insert(assets).values({ slug: `sys_test_asset_${Date.now()}`, name: "Sys Test Asset", decimalPlaces: 0 }).returning();
    const [sys] = await db.insert(wallets).values({
      assetId: newAsset.id,
      type: "SYSTEM",
      balance: 0n,
    }).returning();

    await expect(transactionService.transfer({
      fromWalletId: sys.id,
      toWalletId: user1WalletId,
      amount: 1n,
      type: "SPEND",
      idempotencyKey: `sys-debit-fail-${Date.now()}`,
    })).rejects.toThrow(/Insufficient funds/);
  });

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

    const tx = await db.query.transactions.findFirst({
      where: (transactions, { eq }) => eq(transactions.idempotencyKey, key),
    });

    const entries = await db.query.ledgerEntries.findMany({
      where: (ledgerEntries, { eq }) => eq(ledgerEntries.transactionId, tx!.id),
    });

    expect(entries.length).toBe(2);
    
    const debit = entries.find(e => e.direction === "DEBIT");
    const credit = entries.find(e => e.direction === "CREDIT");

    expect(debit!.amount).toBe(testAmount);
    expect(credit!.amount).toBe(testAmount);
  });
});
