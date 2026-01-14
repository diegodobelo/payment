# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
# Start development server with hot reload
npm run dev

# Start worker process with hot reload
npm run worker:dev

# Build for production
npm run build

# Type check
npm run typecheck

# Run tests
npm test              # Watch mode
npm run test:run      # Single run

# Database
npm run db:migrate    # Apply migrations
npm run db:generate   # Generate migrations from schema changes
npm run db:seed       # Seed sample data
npm run db:studio     # Open Drizzle Studio GUI

# Infrastructure (PostgreSQL + Redis)
docker-compose up -d
```

## Architecture Overview

This is an automated payment issue processing service with a decision engine and job queue. Issues flow through: `pending → processing → (resolved | awaiting_review | failed)`.

### Tech Stack
- **API**: Fastify with Zod validation
- **Database**: PostgreSQL with Drizzle ORM
- **Queue**: BullMQ with Redis
- **Testing**: Vitest

### Core Layers

```
src/
├── api/           # HTTP layer (routes, controllers, middleware, schemas)
├── services/      # Business logic and decision engine
├── repositories/  # Data access with PII encryption/audit logging
├── queue/         # BullMQ workers and job definitions
├── db/            # Drizzle schema, migrations, client
├── lib/           # Utilities (encryption, logger)
└── config/        # Zod-validated environment configuration
```

### Key Domain Concepts

**Issue Types**: `decline`, `missed_installment`, `dispute`, `refund_request`

**Decision Types**: `approve_retry`, `approve_refund`, `reject`, `escalate`

**Issue Status Flow**: `pending` → `processing` → `resolved` | `awaiting_review` | `failed`

### Data Layer Patterns

- **PII Encryption**: Customer email/name and payment methods are encrypted with AES-256-GCM at the application level. Use repository methods that handle encryption/decryption.
- **Audit Logging**: All writes and PII access are logged to `audit_logs`. Repositories accept an optional `AuditContext` parameter.
- **Repositories**: Located in `src/repositories/`. Always use these instead of direct DB access to ensure encryption and audit compliance.

### TypeScript Configuration

Uses strict settings including `exactOptionalPropertyTypes: true`. When passing optional properties, omit them entirely rather than setting to `undefined`:

```typescript
// Wrong - will cause type error
{ status, resolvedAt: undefined }

// Correct
const params = { status };
if (shouldResolve) params.resolvedAt = new Date();
```

### Environment

Requires `ENCRYPTION_KEY` (64 hex chars). Generate with: `openssl rand -hex 32`

Configuration is validated at startup via Zod in `src/config/index.ts`. Invalid config causes immediate exit.
