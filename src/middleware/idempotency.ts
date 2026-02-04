import type { Request, Response, NextFunction } from "express";

export const idempotencyMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const idempotencyKey = req.headers["idempotency-key"];

  if (req.method === "POST" && !idempotencyKey) {
    return res.status(400).json({
      error: "Idempotency-Key header is required for POST requests",
    });
  }

  next();
};
