#!/bin/bash

echo "🚀 Starting Wallet Service Setup..."

# 1. Install dependencies
echo "📦 Installing dependencies..."
bun install

# 2. Spin up the database
echo "🐘 Starting PostgreSQL via Docker..."
docker-compose up -d db

# 3. Wait for DB to be ready
echo "⏳ Waiting for database to be ready..."
until docker exec wallet-db-dev pg_isready -U postgres; do
  sleep 1
done

# 4. Run migrations
echo "⚙️ Running database migrations..."
bun run db:generate
bun run db:migrate

# 5. Seed data
echo "🌱 Seeding initial data..."
bun run db:seed

echo "✅ Setup complete! You can now run the service with: bun run dev"
