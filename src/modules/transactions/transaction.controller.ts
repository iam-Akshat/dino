import type { Request, Response } from "express";
import { transactionService } from "./transaction.service";
import { db } from "../../db";
import { wallets, assets } from "../../db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

const transactionSchema = z.object({
  userId: z.string().uuid(),
  assetSlug: z.string(),
  amount: z.string().transform((val) => BigInt(val)),
  metadata: z.string().optional(),
});

export class TransactionController {
  private async getSystemWallet(assetSlug: string) {
    const asset = await db.query.assets.findFirst({
      where: eq(assets.slug, assetSlug),
    });

    if (!asset) throw new Error(`Asset ${assetSlug} not found`);

    const systemWallet = await db.query.wallets.findFirst({
      where: and(
        eq(wallets.assetId, asset.id),
        eq(wallets.type, "SYSTEM")
      ),
    });

    if (!systemWallet) throw new Error(`System wallet for ${assetSlug} not found`);
    return systemWallet;
  }

  private async getUserWallet(userId: string, assetSlug: string) {
    const asset = await db.query.assets.findFirst({
      where: eq(assets.slug, assetSlug),
    });

    if (!asset) throw new Error(`Asset ${assetSlug} not found`);

    const userWallet = await db.query.wallets.findFirst({
      where: and(
        eq(wallets.userId, userId),
        eq(wallets.assetId, asset.id)
      ),
    });

    if (!userWallet) throw new Error(`User wallet for ${assetSlug} not found`);
    return userWallet;
  }

  topup = async (req: Request, res: Response) => {
    try {
      const { userId, assetSlug, amount, metadata } = transactionSchema.parse(req.body);
      const idempotencyKey = req.headers["idempotency-key"] as string;

      const systemWallet = await this.getSystemWallet(assetSlug);
      const userWallet = await this.getUserWallet(userId, assetSlug);

      const tx = await transactionService.transfer({
        fromWalletId: systemWallet.id,
        toWalletId: userWallet.id,
        amount,
        type: "TOPUP",
        idempotencyKey,
        metadata,
      });

      if (!tx) throw new Error("Transaction failed to process");

      res.status(201).json({
        id: tx.id,
        type: tx.type,
        amount: tx.amount.toString(),
        createdAt: tx.createdAt
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };

  bonus = async (req: Request, res: Response) => {
    try {
      const { userId, assetSlug, amount, metadata } = transactionSchema.parse(req.body);
      const idempotencyKey = req.headers["idempotency-key"] as string;

      const systemWallet = await this.getSystemWallet(assetSlug);
      const userWallet = await this.getUserWallet(userId, assetSlug);

      const tx = await transactionService.transfer({
        fromWalletId: systemWallet.id,
        toWalletId: userWallet.id,
        amount,
        type: "BONUS",
        idempotencyKey,
        metadata,
      });

      if (!tx) throw new Error("Transaction failed to process");

      res.status(201).json({
        id: tx.id,
        type: tx.type,
        amount: tx.amount.toString(),
        createdAt: tx.createdAt
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };

  spend = async (req: Request, res: Response) => {
    try {
      const { userId, assetSlug, amount, metadata } = transactionSchema.parse(req.body);
      const idempotencyKey = req.headers["idempotency-key"] as string;

      const systemWallet = await this.getSystemWallet(assetSlug);
      const userWallet = await this.getUserWallet(userId, assetSlug);

      const tx = await transactionService.transfer({
        fromWalletId: userWallet.id,
        toWalletId: systemWallet.id,
        amount,
        type: "SPEND",
        idempotencyKey,
        metadata,
      });

      if (!tx) throw new Error("Transaction failed to process");

      res.status(201).json({
        id: tx.id,
        type: tx.type,
        amount: tx.amount.toString(),
        createdAt: tx.createdAt
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };
}

export const transactionController = new TransactionController();
