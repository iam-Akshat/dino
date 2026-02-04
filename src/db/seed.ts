import { db } from "./index";
import { assets, wallets, users } from "./schema";
import { v4 as uuidv4 } from "uuid";
import { eq, and } from "drizzle-orm";

async function seed() {
  console.log("🌱 Seeding database...");

  // 1. Create Assets
  const assetsResult = await db.insert(assets).values([
    {
      slug: "gold_coins",
      name: "Gold Coins",
      decimalPlaces: 0,
    },
    {
      slug: "diamonds",
      name: "Diamonds",
      decimalPlaces: 0,
    }
  ]).onConflictDoNothing().returning();
  
  let goldCoins = assetsResult.find(a => a.slug === "gold_coins");
  
  if (!goldCoins) {
    goldCoins = await db.query.assets.findFirst({
      where: eq(assets.slug, "gold_coins")
    });
  }
  
  if (!goldCoins) throw new Error("Failed to create or find gold coins asset");

  console.log("✅ Assets created or already exist");

  // 2. Create Users
  const usersResult = await db.insert(users).values([
    { email: "user1@example.com", username: "user1" },
    { email: "user2@example.com", username: "user2" }
  ]).onConflictDoNothing().returning();

  let user1 = usersResult.find(u => u.email === "user1@example.com");
  let user2 = usersResult.find(u => u.email === "user2@example.com");

  if (!user1) user1 = await db.query.users.findFirst({ where: eq(users.email, "user1@example.com") });
  if (!user2) user2 = await db.query.users.findFirst({ where: eq(users.email, "user2@example.com") });

  if (!user1 || !user2) throw new Error("Failed to create or find users");

  console.log(`✅ Users created: ${user1.id}, ${user2.id}`);

  // 3. Create System Wallet (Treasury)
  let systemWallet = await db.query.wallets.findFirst({
    where: and(
      eq(wallets.assetId, goldCoins.id),
      eq(wallets.type, "SYSTEM")
    )
  });

  if (!systemWallet) {
    const systemWalletsResult = await db.insert(wallets).values({
      assetId: goldCoins.id,
      type: "SYSTEM",
      balance: 1000000n, // Initial treasury
    }).returning();
    systemWallet = systemWalletsResult[0];
    console.log("✅ System wallet created");
  } else {
    console.log("✅ System wallet already exists");
  }

  if (!systemWallet) throw new Error("Failed to create or find system wallet");

  // 4. Create User Wallets (Only if none exist)
  const wallet1 = await db.query.wallets.findFirst({
    where: and(
      eq(wallets.userId, user1.id),
      eq(wallets.assetId, goldCoins.id)
    )
  });

  if (!wallet1) {
    await db.insert(wallets).values({
      userId: user1.id,
      assetId: goldCoins.id,
      type: "USER",
      balance: 100n,
    });
    console.log(`✅ User 1 wallet created (100 Gold Coins)`);
  } else {
    console.log("✅ User 1 wallet already exists");
  }

  const wallet2 = await db.query.wallets.findFirst({
    where: and(
      eq(wallets.userId, user2.id),
      eq(wallets.assetId, goldCoins.id)
    )
  });

  if (!wallet2) {
    await db.insert(wallets).values({
      userId: user2.id,
      assetId: goldCoins.id,
      type: "USER",
      balance: 50n,
    });
    console.log(`✅ User 2 wallet created (50 Gold Coins)`);
  } else {
    console.log("✅ User 2 wallet already exists");
  }

  console.log("✨ Seeding complete");
  process.exit(0);
}

seed().catch((err) => {
  console.error("❌ Seeding failed:", err);
  process.exit(1);
});
