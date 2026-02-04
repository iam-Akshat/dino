import { db } from "../../db";
import { wallets, assets, ledgerEntries, transactions } from "../../db/schema";
import { eq, and, desc, lt, sql } from "drizzle-orm";
import { logger } from "../../utils/logger";

export class WalletService {
  async createWallet(params: {
    userId?: string;
    assetSlug: string;
    type: "USER" | "SYSTEM";
    initialBalance?: bigint;
  }) {
    logger.info({ userId: params.userId, assetSlug: params.assetSlug, type: params.type }, "Creating wallet");
    // 1. Find asset
    const asset = await db.query.assets.findFirst({
      where: eq(assets.slug, params.assetSlug),
    });

    if (!asset) {
      logger.warn({ assetSlug: params.assetSlug }, "Wallet creation failed: Asset not found");
      throw new Error(`Asset with slug ${params.assetSlug} not found`);
    }

    // 2. Create wallet
    const [wallet] = await db.insert(wallets).values({
      userId: params.userId,
      assetId: asset.id,
      type: params.type,
      balance: params.initialBalance ?? 0n,
    }).returning();

    if (!wallet) {
      logger.error({ userId: params.userId }, "Wallet creation failed: No record returned");
      throw new Error("Failed to create wallet");
    }

    logger.info({ walletId: wallet.id }, "Wallet created successfully");
    return wallet;
  }

  async getWallet(walletId: string) {
    const wallet = await db.query.wallets.findFirst({
      where: eq(wallets.id, walletId),
    });

    if (!wallet) {
      logger.warn({ walletId }, "Wallet lookup failed: Not found");
      throw new Error("Wallet not found");
    }

    return wallet;
  }

  async getBalance(walletId: string) {
    const wallet = await this.getWallet(walletId);
    return wallet.balance;
  }

  async getHistory(walletId: string, limit: number = 10, cursor?: string) {
    logger.info({ walletId, limit, cursor }, "Fetching wallet history");
    // Verify wallet exists
    await this.getWallet(walletId);

    const entries = await db
      .select({
        id: ledgerEntries.id,
        amount: ledgerEntries.amount,
        direction: ledgerEntries.direction,
        createdAt: ledgerEntries.createdAt,
        transactionId: transactions.id,
        type: transactions.type,
        metadata: transactions.metadata,
      })
      .from(ledgerEntries)
      .innerJoin(transactions, eq(ledgerEntries.transactionId, transactions.id))
      .where(
        and(
          eq(ledgerEntries.walletId, walletId),
          cursor ? lt(ledgerEntries.createdAt, sql`${cursor}::timestamp`) : undefined
        )
      )
      .orderBy(desc(ledgerEntries.createdAt), desc(ledgerEntries.id))
      .limit(limit + 1);

    const hasNextPage = entries.length > limit;
    const data = entries.slice(0, limit);
    const lastEntry = data[data.length - 1];
    const nextCursor = hasNextPage && lastEntry ? lastEntry.createdAt : null;

    logger.debug({ walletId, count: data.length, hasNextPage }, "Wallet history fetched");

    return {
      data: data.map(entry => ({
        ...entry,
        amount: entry.amount.toString(),
      })),
      pagination: {
        nextCursor,
      },
    };
  }
}

export const walletService = new WalletService();
