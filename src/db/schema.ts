import { pgTable, uuid, varchar, bigint, timestamp, check, pgEnum, index, integer } from "drizzle-orm/pg-core";
import { sql, relations } from "drizzle-orm";

export const walletTypeEnum = pgEnum("wallet_type", ["USER", "SYSTEM"]);
export const transactionTypeEnum = pgEnum("transaction_type", ["TOPUP", "SPEND", "BONUS"]);
export const directionEnum = pgEnum("direction", ["CREDIT", "DEBIT"]);
export const assetStatusEnum = pgEnum("asset_status", ["ACTIVE", "FROZEN"]);
export const userStatusEnum = pgEnum("user_status", ["ACTIVE", "BANNED"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  username: varchar("username", { length: 100 }).notNull(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  status: userStatusEnum("status").notNull().default("ACTIVE"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const assets = pgTable("assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: varchar("slug", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 100 }).notNull(),
  decimalPlaces: integer("decimal_places").notNull().default(0),
  status: assetStatusEnum("status").notNull().default("ACTIVE"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const wallets = pgTable("wallets", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id), // Nullable for system wallets
  assetId: uuid("asset_id").references(() => assets.id).notNull(),
  balance: bigint("balance", { mode: "bigint" }).notNull().default(sql`0`),
  type: walletTypeEnum("type").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  balanceCheck: check("balance_check", sql`${table.balance} >= 0`),
  userAssetUnique: { name: "user_asset_unique", columns: [table.userId, table.assetId] },
  systemAssetUnique: { name: "system_asset_unique", columns: [table.assetId], where: sql`${table.userId} IS NULL` },
  userIdIdx: index("wallet_user_id_idx").on(table.userId),
}));

export const walletsRelations = relations(wallets, ({ one }) => ({
  user: one(users, {
    fields: [wallets.userId],
    references: [users.id],
  }),
  asset: one(assets, {
    fields: [wallets.assetId],
    references: [assets.id],
  }),
}));

export const transactions = pgTable("transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  idempotencyKey: varchar("idempotency_key", { length: 255 }).notNull().unique(),
  type: transactionTypeEnum("type").notNull(),
  assetId: uuid("asset_id").references(() => assets.id).notNull(),
  fromWalletId: uuid("from_wallet_id").references(() => wallets.id),
  toWalletId: uuid("to_wallet_id").references(() => wallets.id),
  amount: bigint("amount", { mode: "bigint" }).notNull(),
  metadata: varchar("metadata", { length: 1000 }), // For audit logs
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  idempotencyIdx: index("idempotency_idx").on(table.idempotencyKey),
}));

export const ledgerEntries = pgTable("ledger_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  transactionId: uuid("transaction_id").references(() => transactions.id).notNull(),
  walletId: uuid("wallet_id").references(() => wallets.id).notNull(),
  amount: bigint("amount", { mode: "bigint" }).notNull(),
  direction: directionEnum("direction").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  transactionIdx: index("transaction_idx").on(table.transactionId),
  walletIdx: index("wallet_idx").on(table.walletId),
}));
