import { db } from "../../db";
import { wallets, transactions, ledgerEntries } from "../../db/schema";
import { sql, eq, and } from "drizzle-orm";
import { logger } from "../../utils/logger";

export interface TransferParams {
  fromWalletId: string;
  toWalletId: string;
  amount: bigint;
  type: "TOPUP" | "SPEND" | "BONUS";
  idempotencyKey: string;
  metadata?: string;
}

export class TransactionService {
  async transfer(params: TransferParams) {
    const { fromWalletId, toWalletId, amount, type, idempotencyKey, metadata } = params;

    logger.info({ fromWalletId, toWalletId, amount: amount.toString(), type, idempotencyKey }, "Transfer initiated");

    if (amount <= 0n) {
      logger.warn({ amount: amount.toString(), idempotencyKey }, "Transfer failed: Amount must be greater than zero");
      throw new Error("Amount must be greater than zero");
    }

    if (fromWalletId === toWalletId) {
      logger.warn({ fromWalletId, toWalletId, idempotencyKey }, "Transfer failed: Source and destination wallets must be different");
      throw new Error("Source and destination wallets must be different");
    }

    return await db.transaction(async (tx) => {
      // 1. Idempotency Check & Parameter Validation
      const existingTx = await tx.query.transactions.findFirst({
        where: eq(transactions.idempotencyKey, idempotencyKey),
      });

      if (existingTx) {
        logger.info({ idempotencyKey }, "Duplicate transaction detected (idempotency)");
        // CRITICAL: Verify parameters match to prevent "Ghost" transactions
        // @ts-ignore - checking for new columns
        if (existingTx.amount !== amount || existingTx.fromWalletId !== fromWalletId || existingTx.toWalletId !== toWalletId) {
          logger.error({ idempotencyKey, original: existingTx, new: params }, "Idempotency key mismatch");
          throw new Error("Idempotency key mismatch: request parameters differ from original transaction");
        }
        return existingTx;
      }

      // 2. Lock Wallets in Deterministic Order (Avoid Deadlocks)
      const lockOrder = [fromWalletId, toWalletId].sort();
      
      for (const walletId of lockOrder) {
        await tx.execute(sql`SELECT id FROM ${wallets} WHERE id = ${walletId} FOR UPDATE`);
      }

      // 3. Get and Validate Balances
      const fromWallet = await tx.query.wallets.findFirst({
        where: eq(wallets.id, fromWalletId),
      });

      if (!fromWallet) {
        logger.warn({ fromWalletId, idempotencyKey }, "Transfer failed: Source wallet not found");
        throw new Error("Source wallet not found");
      }
      if (fromWallet.balance < amount) {
        logger.warn({ fromWalletId, balance: fromWallet.balance.toString(), amount: amount.toString(), idempotencyKey }, "Transfer failed: Insufficient funds");
        throw new Error("Insufficient funds");
      }

      const toWallet = await tx.query.wallets.findFirst({
        where: eq(wallets.id, toWalletId),
      });

      if (!toWallet) {
        logger.warn({ toWalletId, idempotencyKey }, "Transfer failed: Destination wallet not found");
        throw new Error("Destination wallet not found");
      }
      if (fromWallet.assetId !== toWallet.assetId) {
        logger.warn({ fromWalletId, toWalletId, idempotencyKey }, "Transfer failed: Asset mismatch");
        throw new Error("Asset mismatch");
      }

      // 4. Record Transaction Header (With full context for idempotency)
      const [transaction] = await tx.insert(transactions).values({
        idempotencyKey,
        type,
        assetId: fromWallet.assetId,
        fromWalletId,
        toWalletId,
        amount,
        metadata,
      }).returning();

      if (!transaction) {
        logger.error({ idempotencyKey }, "Transfer failed: Could not record transaction header");
        throw new Error("Failed to record transaction header");
      }

      // 5. Update Balances
      await tx.update(wallets)
        .set({ balance: sql`${wallets.balance} - ${amount}`, updatedAt: new Date() })
        .where(eq(wallets.id, fromWalletId));

      await tx.update(wallets)
        .set({ balance: sql`${wallets.balance} + ${amount}`, updatedAt: new Date() })
        .where(eq(wallets.id, toWalletId));

      // 6. Record Ledger Entries
      await tx.insert(ledgerEntries).values([
        {
          transactionId: transaction.id,
          walletId: fromWalletId,
          amount: amount,
          direction: "DEBIT",
        },
        {
          transactionId: transaction.id,
          walletId: toWalletId,
          amount: amount,
          direction: "CREDIT",
        }
      ]);

      logger.info({ transactionId: transaction.id, idempotencyKey }, "Transfer completed successfully");
      return transaction;
    });
  }
}

export const transactionService = new TransactionService();

