import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import pinoHttp from "pino-http";
import { logger } from "./utils/logger";
import { idempotencyMiddleware } from "./middleware/idempotency";
import { transactionController } from "./modules/transactions/transaction.controller";
import { walletController } from "./modules/wallets/wallet.controller";

dotenv.config();

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(pinoHttp({ logger }));

// Routes
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.get("/users", walletController.listUsers);
app.get("/assets", walletController.listAssets);
app.get("/users/:userId/wallets", walletController.listUserWallets);

app.get("/wallets/:userId/:assetSlug/balance", walletController.getBalance);
app.get("/wallets/:id/history", walletController.getHistory);

app.post("/transactions/topup", idempotencyMiddleware, transactionController.topup);
app.post("/transactions/bonus", idempotencyMiddleware, transactionController.bonus);
app.post("/transactions/spend", idempotencyMiddleware, transactionController.spend);

app.use(express.static("public"));

// Global Error Handler
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  req.log.error(err);
  res.status(err.status || 500).json({
    error: err.message || "Internal Server Error",
  });
});

export default app;

if (process.env.NODE_ENV !== "test") {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`🚀 Wallet Service running on http://localhost:${port}`);
  });
}
