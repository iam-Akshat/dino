# Internal Wallet Service

A high-performance, ACID-compliant ledger-based wallet service built with **Bun**, **Express**, and **Drizzle ORM**.

## Table of Contents
1. [Architecture](#architecture)
2. [Database Schema](#database-schema)
3. [Setup Instructions](#setup-instructions)
4. [Scalability Decisions](#scalability-decisions)
5. [API Reference](#api-reference)

---

## Architecture

This service follows a **Layered (Clean) Architecture** pattern to ensure separation of concerns and testability.

### Layers
1.  **Interface Layer (HTTP & UI)**
    *   **Dashboard**: An interactive HTML/JS UI available at the root (`/`) for real-time wallet management.
    *   **Controllers**: Handle HTTP requests, validate input (Zod), and map responses.
    *   **Middleware**: Enforce `Idempotency-Key` headers for all write operations.

2.  **Service Layer (Business Logic)**
    *   **Orchestration**: Manages complex workflows like atomic transfers.
    *   **Integrity**: Enforces double-entry ledger rules and idempotency.
    *   **Concurrency**: Uses pessimistic locking to prevent race conditions.

3.  **Data Layer (Persistence)**
    *   **Drizzle ORM**: Provides type-safe database access.
    *   **PostgreSQL**: The source of truth, handling ACID transactions and constraints.

### Key Design Patterns
*   **Double-Entry Ledger**: Every financial move is recorded as a balanced set of entries (Debit/Credit), ensuring auditability.
*   **Event Sourcing**: While the current balance is cached in `wallets`, all changes are derived from `ledger_entries`, allowing for reconstruction.
*   **Idempotency**: Clients must provide a unique `Idempotency-Key` for every write operation. The server validates that retries are identical to the original request.

---

## Database Schema

The schema is optimized for high write throughput and data integrity.

### `users`
Stores core user identity. Enforces unique email addresses.
*   `id`: UUID Primary Key.
*   `email`: Unique varchar.
*   `status`: ENUM (ACTIVE, BANNED) - allows for future account freezing logic.

### `assets`
Defines the currencies or credits supported by the system.
*   `id`: UUID Primary Key.
*   `slug`: Unique identifier (e.g., `gold_coins`).
*   `status`: ENUM (ACTIVE, FROZEN) - allows disabling specific currencies.

### `wallets`
Represents a user's balance for a specific asset.
*   `user_id`: Foreign Key to `users` (Nullable for System/Treasury wallets).
*   `asset_id`: Foreign Key to `assets`.
*   `balance`: `bigint` (High precision for financial data).
*   **Constraints**:
    *   `balance >= 0`: Prevents negative balances.
    *   `UNIQUE (user_id, asset_id)`: Ensures one wallet per user per asset.
    *   `UNIQUE (asset_id) WHERE user_id IS NULL`: Ensures one system wallet per asset.

### `transactions`
The transaction header. Stores the "Intent" of a financial action.
*   `idempotency_key`: Unique string to prevent duplicate processing.
*   `amount`, `asset_id`, `from_wallet_id`, `to_wallet_id`: Stored here to allow full reconstruction and validation of idempotent retries.

### `ledger_entries`
The immutable record of every movement of value.
*   `transaction_id`: Links to the header.
*   `wallet_id`: The account affected.
*   `direction`: ENUM (CREDIT, DEBIT).
*   **Auditability**: A transfer of 100 coins creates two rows: one debiting Source (-100) and one crediting Destination (+100).

---

## Setup Instructions

### Prerequisites
*   **Docker** & **Docker Compose** (for database).
*   **Bun** (Runtime).

### 1. Install Dependencies
```bash
bun install
```

### 2. Start Database
```bash
docker-compose up -d db
```

### 3. Run Migrations & Seed
```bash
bun run db:generate
bun run db:migrate
bun run db:seed
```

### 4. Start Development Server
```bash
bun run dev
```

### 5. Access the Dashboard
Open your browser and navigate to `http://localhost:3000`. The dashboard allows you to:
*   Switch between seeded users.
*   View balances for all assets (Gold Coins, Diamonds).
*   Execute Topup, Spend, and Bonus transactions.
*   View real-time transaction ledger history.

### Running Tests
```bash
export NODE_ENV=test
bun test
```

---

## Technology Stack & Rationale

- **Bun**: Chosen for its high-performance runtime and integrated toolchain (testing, bundling, package management). Its speed is critical for financial services requiring low latency.
- **Express**: A mature, minimalist framework that provides reliable routing and middleware support without excessive overhead.
- **Drizzle ORM**: Selected for its "TypeScript-first" approach and near-zero overhead. Unlike "heavy" ORMs, it allows for fine-grained control over SQL (essential for `FOR UPDATE` locks) while maintaining type safety.
- **PostgreSQL**: Used as the source of truth for its robust support for ACID transactions, complex constraints, and row-level locking capabilities.
- **Tailwind CSS**: Used for the dashboard to quickly build a responsive, professional UI with minimal custom CSS.

## Scalability & Concurrency Decisions

### 1. Pessimistic Locking (`SELECT ... FOR UPDATE`)
To prevent race conditions (e.g., double-spending), we lock the relevant wallet rows *before* modifying the balance.
*   **Trade-off**: Reduces concurrency for the exact same wallet.
*   **Benefit**: Guarantees balance integrity under high contention.

### 2. Deterministic Lock Ordering (Deadlock Avoidance)
When a transaction involves two wallets (User -> System), we **always lock the wallet with the lower UUID first**.
*   **Problem**: If Transaction A locks Wallet 1 and waits for Wallet 2, while Transaction B locks Wallet 2 and waits for Wallet 1, a **Deadlock** occurs.
*   **Solution**: Sorting IDs ensures a global lock order, preventing circular waits.

### 3. UUIDs vs Sequential IDs
We use UUIDs for all primary keys (`id`).
*   **Benefit**: Allows distributed systems to generate IDs without coordination.
*   **Optimization**: We sort UUIDs before locking to ensure the lock order is deterministic.

### 4. BigInt for Currency
We use PostgreSQL `numeric` (mapped via Drizzle as `bigint`) instead of `float`.
*   **Benefit**: Avoids floating-point rounding errors (e.g., `0.1 + 0.2 !== 0.3`).
*   **API**: Clients send amounts as strings (`"100"`) to avoid JSON number precision limits.

---

## API Reference

### Endpoints

#### `GET /`
Serves the interactive dashboard.

#### `GET /health`
Health check endpoint.

#### `GET /users`
Lists all registered users.

#### `GET /assets`
Lists all available assets.

#### `GET /users/:userId/wallets`
Lists all wallets for a specific user, including asset details and balances.

#### `GET /wallets/:id/history`
Retrieves paginated transaction history for a specific wallet.
*   **Query Params**: `limit` (default 10), `cursor` (for pagination).

#### `GET /wallets/:userId/:assetSlug/balance`
Retrieves the current balance for a user.

**Response:**
```json
{
  "balance": "100",
  "asset": "gold_coins",
  "userId": "uuid"
}
```

#### `POST /transactions/topup`
Credits a user's wallet (System -> User).
*   **Header**: `Idempotency-Key: <unique-key>`
*   **Body**:
    ```json
    {
      "userId": "uuid",
      "assetSlug": "gold_coins",
      "amount": "100"
    }
    ```

#### `POST /transactions/spend`
Debits a user's wallet (User -> System).
*   **Header**: `Idempotency-Key: <unique-key>`
*   **Body**:
    ```json
    {
      "userId": "uuid",
      "assetSlug": "gold_coins",
      "amount": "50"
    }
    ```

#### `POST /transactions/bonus`
Issues a bonus (System -> User).
*   **Header**: `Idempotency-Key: <unique-key>`
