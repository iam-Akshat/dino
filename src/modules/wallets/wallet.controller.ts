import type { Request, Response } from "express";
import { walletService } from "./wallet.service";
import { db } from "../../db";
import { assets, wallets, users } from "../../db/schema";
import { eq, and } from "drizzle-orm";

export class WalletController {
  listUsers = async (req: Request, res: Response) => {
    try {
      const allUsers = await db.query.users.findMany();
      res.json(allUsers);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };

  listAssets = async (req: Request, res: Response) => {
    try {
      const allAssets = await db.query.assets.findMany();
      res.json(allAssets);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };

  listUserWallets = async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      const userWallets = await db.query.wallets.findMany({
        where: eq(wallets.userId, userId as string),
        with: {
          asset: true,
        },
      });

      res.json(userWallets.map(w => ({
        ...w,
        balance: w.balance.toString(),
      })));
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };

  getBalance = async (req: Request, res: Response) => {
    try {
      const { userId, assetSlug } = req.params;

      if (!userId || !assetSlug) {
        return res.status(400).json({ error: "Missing userId or assetSlug" });
      }

      const asset = await db.query.assets.findFirst({
        where: eq(assets.slug, assetSlug as string),
      });

      if (!asset) {
        return res.status(404).json({ error: "Asset not found" });
      }

      const wallet = await db.query.wallets.findFirst({
        where: and(
          eq(wallets.userId, userId as string),
          eq(wallets.assetId, asset.id)
        ),
      });

      if (!wallet) {
        return res.status(404).json({ error: "Wallet not found for this user and asset" });
      }

      res.json({
        balance: wallet.balance.toString(),
        asset: asset.slug,
        userId: wallet.userId,
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };

  getHistory = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { limit, cursor } = req.query;

      if (!id) {
        return res.status(400).json({ error: "Missing wallet id" });
      }

      const parsedLimit = limit ? parseInt(limit as string, 10) : 10;
      const history = await walletService.getHistory(
        id as string,
        parsedLimit,
        cursor as string | undefined
      );

      res.json(history);
    } catch (error: any) {
      if (error.message === "Wallet not found") {
        return res.status(404).json({ error: error.message });
      }
      res.status(400).json({ error: error.message });
    }
  };
}

export const walletController = new WalletController();
