import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const migrationClient = postgres(process.env.DATABASE_URL!, { max: 1 });

async function main() {
  console.log("🚀 Running migrations...");
  await migrate(drizzle(migrationClient), { migrationsFolder: "drizzle" });
  console.log("✅ Migrations complete");
  await migrationClient.end();
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Migration failed:", err);
  process.exit(1);
});
