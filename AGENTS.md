Context
You are acting as an expert Backend Engineer. You are continuing work on the Internal Wallet Service, a high-performance, ACID-compliant financial system built with Bun, Express, and Drizzle ORM. The project implements a Double-Entry Ledger architecture to ensure data integrity.
What We Have Built
We have successfully implemented the core wallet service with the following features:
1.  Double-Entry Ledger System: Every financial action is atomic and recorded as a balanced Debit/Credit entry in ledger_entries.
2.  Concurrency Safety: Implemented Pessimistic Locking (SELECT ... FOR UPDATE) and Deterministic ID Ordering to prevent race conditions and deadlocks.
3.  Hardened Idempotency: Clients must send an Idempotency-Key header. The server validates request parameters against stored records to prevent "ghost" transactions (retries with different amounts).
4.  Schema Integrity:
    *   users table for identity.
    *   wallets table with constraints preventing duplicate wallets for a user/asset and singleton system wallets.
    *   transactions table enhanced with amount, from_wallet_id, and to_wallet_id for full auditability.
Current Status
*   Tests: 34 tests passing, covering unit logic, API integration, and high-concurrency stress tests.
*   Infrastructure: Dockerized setup with separate compose files for Dev (DB only) and Prod (Full stack).
*   Documentation: A comprehensive README.md exists detailing architecture, schema, and setup.
Key Files in Scope
*   src/db/schema.ts: Database definitions (Users, Wallets, Assets, Transactions, Ledger).
*   src/modules/transactions/transaction.service.ts: Core business logic for atomic transfers.
*   src/modules/wallets/wallet.service.ts: Wallet management.
*   src/tests/: Extensive test suite including transaction.integrity.test.ts (Concurrency & Idempotency tests).
Next Steps (Suggested Roadmap)
If asked what to do next, prioritize these tasks:
1.  Feature Completion: Implement the GET /wallets/:id/history endpoint to allow users to view their transaction ledger.
2.  Deployment: Deploy the application to a cloud provider (e.g., Render, Railway) using the docker-compose.prod.yml configuration.
3.  Observability: Add structured logging (e.g., Winston or Bunyan) to track transaction volumes and errors in production.
***
Code Reference: Core Transfer Logic
When working on TransactionService.transfer or schema.ts, refer to this logic:
*   Wallets are locked in Ascending UUID Order to avoid deadlocks.
*   Idempotency checks validate amount, fromWalletId, and toWalletId against the DB.
*   wallets table uses Partial Unique Indexes: UNIQUE (user_id, asset_id) for users and UNIQUE (asset_id) WHERE user_id IS NULL for system accounts.
