# Payment Processing Service

Automated payment issue processing service with decision engine and asynchronous job queue support. Built with TypeScript, Fastify, BullMQ, PostgreSQL, and Redis.

## Prerequisites

- Node.js >= 20.0.0
- PostgreSQL 16+
- Redis 7+

## Environment Variables

Copy `.env.example` to `.env` and configure the following variables:

### Application

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | Environment mode (`development`, `production`, `test`) | `development` |
| `PORT` | HTTP server port | `3000` |
| `LOG_LEVEL` | Logging level (`debug`, `info`, `warn`, `error`) | `info` |

### Database

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://postgres:postgres@localhost:5432/payment_issues` |
| `DATABASE_POOL_MIN` | Minimum pool connections | `2` |
| `DATABASE_POOL_MAX` | Maximum pool connections | `10` |

### Redis

| Variable | Description | Default |
|----------|-------------|---------|
| `REDIS_URL` | Redis connection string | `redis://localhost:6379` |

### Queue Processing

| Variable | Description | Default |
|----------|-------------|---------|
| `QUEUE_CONCURRENCY` | Number of parallel jobs | `5` |
| `QUEUE_MAX_RETRIES` | Maximum retry attempts | `5` |
| `QUEUE_BACKOFF_DELAY_MS` | Delay between retries (ms) | `2000` |

### Decision Engine

| Variable | Description | Default |
|----------|-------------|---------|
| `CONFIDENCE_THRESHOLD` | Minimum confidence for auto-approval | `0.80` |

### Security (Required)

| Variable | Description | Default |
|----------|-------------|---------|
| `ENCRYPTION_KEY` | AES-256-GCM key for PII encryption (64 hex chars) | - |

Generate a secure encryption key:
```bash
openssl rand -hex 32
```

### Rate Limiting

| Variable | Description | Default |
|----------|-------------|---------|
| `RATE_LIMIT_MAX` | Maximum requests per window | `100` |
| `RATE_LIMIT_WINDOW_MS` | Rate limit window duration (ms) | `60000` |

### Health & Shutdown

| Variable | Description | Default |
|----------|-------------|---------|
| `HEALTH_CHECK_TIMEOUT_MS` | Health check timeout (ms) | `2000` |
| `SHUTDOWN_TIMEOUT_MS` | Graceful shutdown timeout (ms) | `30000` |

## Local Development

Start PostgreSQL and Redis using Docker Compose:

```bash
docker-compose up -d
```

Install dependencies and run migrations:

```bash
npm install
npm run db:migrate
npm run db:seed  # Optional: load sample data
```

Start the development server:

```bash
npm run dev
```

Start the worker (in a separate terminal):

```bash
npm run worker:dev
```

## Production Deployment

### 1. Build the Application

```bash
npm ci --production=false
npm run build
```

This compiles TypeScript to the `dist/` directory.

### 2. Configure Environment

Set all required environment variables. At minimum:

```bash
export NODE_ENV=production
export DATABASE_URL=postgresql://user:password@host:5432/payment_issues
export REDIS_URL=redis://host:6379
export ENCRYPTION_KEY=$(openssl rand -hex 32)  # Generate once and store securely
```

### 3. Run Database Migrations

```bash
npm run db:migrate
```

### 4. Start the Server

```bash
npm start
```

### 5. Start the Worker

Run in a separate process:

```bash
node dist/worker.js
```

Or use a process manager like PM2:

```bash
pm2 start dist/server.js --name "payment-api"
pm2 start dist/worker.js --name "payment-worker"
```

## Available Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start development server with hot reload |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Start production server |
| `npm run worker` | Run job worker |
| `npm run worker:dev` | Run job worker with hot reload |
| `npm test` | Run tests in watch mode |
| `npm run test:run` | Run tests once |
| `npm run test:coverage` | Run tests with coverage report |
| `npm run db:generate` | Generate migrations from schema changes |
| `npm run db:migrate` | Apply pending database migrations |
| `npm run db:seed` | Seed database with sample data |
| `npm run db:studio` | Open Drizzle Studio (database GUI) |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Type-check without emitting |

## Security

### PII Encryption

Sensitive fields (email, name, payment method) are encrypted at rest using AES-256-GCM. The encryption key must be:
- 64 hexadecimal characters (32 bytes)
- Kept secret and never committed to version control
- Rotated according to your security policies

### Audit Logging

All data changes are recorded in the `audit_logs` table, including:
- Entity type and ID
- Action performed
- Actor and IP address
- Request ID for tracing
- Before/after changes (JSONB)

### Log Redaction

The logger automatically redacts sensitive information:
- Authorization headers
- Passwords and credentials
- Email and name fields
- Payment method details
- Encryption keys

## API Usage

### Create Issue

```bash
curl -X POST http://localhost:3000/api/v1/issues \
  -H "Content-Type: application/json" \
  -d '{
    "idempotency_key": "test-decline-001",
    "type": "decline",
    "customer_id": "cust_042",
    "transaction_id": "txn_5521",
    "details": {
      "error_code": "insufficient_funds",
      "auto_retry_count": 1
    },
    "priority": "normal"
  }'
```

### Valid Values (from sample data)

| Field | Options |
|-------|---------|
| `customer_id` | `cust_042`, `cust_108`, `cust_217`, `cust_315` |
| `transaction_id` | `txn_5521`, `txn_4892`, `txn_6103`, `txn_5998`, `txn_6201` |
| `type` | `decline`, `missed_installment`, `dispute`, `refund_request` |
| `priority` | `low`, `normal`, `high`, `critical` |

### Details Schema by Issue Type

**decline**
```json
{
  "error_code": "insufficient_funds | card_expired | card_declined",
  "auto_retry_count": 0
}
```

**missed_installment**
```json
{
  "installment_number": 2,
  "total_installments": 4,
  "amount_due": 62.50,
  "days_overdue": 5
}
```

**dispute**
```json
{
  "reason": "item_not_received | unauthorized | product_issue",
  "days_since_purchase": 10
}
```

**refund_request**
```json
{
  "reason": "changed_mind | defective | wrong_item",
  "days_since_purchase": 5,
  "partial_amount": 50.00
}
```

### Other Endpoints

- `GET /api/v1/issues` - List issues (supports `?status=`, `?type=`, `?customer_id=`)
- `GET /api/v1/issues/:id` - Get issue details
- `POST /api/v1/issues/:id/review` - Submit human review
- `GET /health` - Liveness check
- `GET /health/ready` - Readiness check with dependencies
- `GET /docs` - Swagger UI documentation
