import { db } from "./index";
import { assets, wallets, users } from "./schema";
import { v4 as uuidv4 } from "uuid";
import { eq, and } from "drizzle-orm";

async function seed() {
  console.log("🌱 Seeding database...");

  // 1. Create Assets
  await db.insert(assets).values([
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
  ]).onConflictDoNothing();
  
  const allAssets = await db.query.assets.findMany();
  console.log("✅ Assets created or already exist");

  // 2. Create Users
  await db.insert(users).values([
    { email: "user1@example.com", username: "user1" },
    { email: "user2@example.com", username: "user2" }
  ]).onConflictDoNothing();

  const allUsers = await db.query.users.findMany();
  console.log(`✅ Users verified: ${allUsers.length}`);

  // 3. Create System Wallets for ALL assets
  for (const asset of allAssets) {
    let systemWallet = await db.query.wallets.findFirst({
      where: and(
        eq(wallets.assetId, asset.id),
        eq(wallets.type, "SYSTEM")
      )
    });

    if (!systemWallet) {
      await db.insert(wallets).values({
        assetId: asset.id,
        type: "SYSTEM",
        balance: 1000000n, // Initial treasury
      });
      console.log(`✅ System wallet created for ${asset.slug}`);
    } else {
      console.log(`✅ System wallet already exists for ${asset.slug}`);
    }
  }

  // 4. Create User Wallets for ALL users and ALL assets
  for (const user of allUsers) {
    for (const asset of allAssets) {
      const userWallet = await db.query.wallets.findFirst({
        where: and(
          eq(wallets.userId, user.id),
          eq(wallets.assetId, asset.id)
        )
      });

      if (!userWallet) {
        await db.insert(wallets).values({
          userId: user.id,
          assetId: asset.id,
          type: "USER",
          balance: 100n,
        });
        console.log(`✅ Wallet created for ${user.username} - ${asset.slug}`);
      } else {
        console.log(`✅ Wallet already exists for ${user.username} - ${asset.slug}`);
      }
    }
  }

  console.log("✨ Seeding complete");
  process.exit(0);
}

seed().catch((err) => {
  console.error("❌ Seeding failed:", err);
  process.exit(1);
});
