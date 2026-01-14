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
| `DECISION_ENGINE_MODE` | Engine mode (`rules` or `ai`) | `rules` |
| `CONFIDENCE_THRESHOLD` | Minimum confidence for auto-approval (rules) | `0.80` |
| `ANTHROPIC_API_KEY` | API key for AI engine (required when mode=ai) | - |
| `AI_AUTO_RESOLVE_THRESHOLD` | AI confidence % for auto-resolve | `90` |
| `AI_HUMAN_REVIEW_THRESHOLD` | AI confidence % for human review | `70` |

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
| `npm run process-samples` | Run sample issues through decision engine |

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

## AI Decision Engine Architecture

The service supports two decision engine modes: **rules-based** and **AI-powered**. The mode is controlled by the `DECISION_ENGINE_MODE` environment variable.

### Architecture: Option C with Skills

```
Issue → Router → [Specialized Agent + Skill] → Decision
                        ↓
              Uses: decline-policy.md
                    dispute-policy.md
                    refund-policy.md
                    installment-policy.md
```

### Why Skills?

We chose Claude Skills for the following reasons:

1. **Separation of concerns** - Each policy domain is a self-contained markdown file
2. **Easy to update** - Policy changes require editing a skill file, not code
3. **No code deployment for policy updates** - Skills are loaded at runtime
4. **Human readable** - Non-engineers can review and suggest policy changes
5. **Future-ready for ensemble voting** - Each skill can become a voting agent

### Skill Files

Skills are stored in `.claude/skills/`:

| Skill | Purpose |
|-------|---------|
| `decline-policy.md` | Handles payment decline issues (insufficient funds, expired card) |
| `dispute-policy.md` | Handles customer disputes (item not received, unauthorized) |
| `refund-policy.md` | Handles refund requests (changed mind, defective) |
| `installment-policy.md` | Handles missed installment payments |

### Confidence-Based Routing

| Confidence | Action |
|------------|--------|
| ≥ 90% | Auto-execute the recommendation |
| 70-89% | Queue for human review |
| < 70% | Queue for human decision (escalate) |

### Switching Between Modes

**Rules mode (default):**
```bash
DECISION_ENGINE_MODE=rules
```

**AI mode:**
```bash
DECISION_ENGINE_MODE=ai
ANTHROPIC_API_KEY=your-api-key
```

### Processing Sample Issues

Run the demo script to see how issues are processed:

```bash
npm run process-samples
```

Output:
```
| Issue ID  | Type               | Decision      | Confidence | Routing       |
|-----------|--------------------|--------------:|:----------:|---------------|
| iss_001   | decline            | approve_retry |        85% | auto_resolve  |
| iss_002   | missed_installment | approve_retry |        75% | human_review  |
| iss_003   | dispute            |      escalate |        40% | escalate      |
| iss_004   | refund_request     |      escalate |        55% | escalate      |
| iss_005   | decline            | approve_retry |        90% | auto_resolve  |
```

### Adding New Policy Skills

1. Create a new skill file in `.claude/skills/`:

```markdown
# My New Policy Handler

You analyze [issue type] issues and recommend actions.

## Policy Rules
[Your policy rules here]

## Output Format
Return valid JSON:
{
  "decision": "auto_resolve" | "human_review" | "escalate",
  "action": "approve_retry" | "approve_refund" | "reject" | "escalate",
  "confidence": <0-100>,
  "reasoning": "<explanation>",
  "policyApplied": "<which rule>"
}
```

2. Update `SKILL_MAP` in `src/services/aiDecisionEngine.ts`

### Human Review Analytics

The system tracks AI vs human decision agreement in the `decision_analytics` table:

- `ai_decision` - What the AI recommended
- `human_decision` - What the human chose
- `agreement` - `agreed`, `modified`, or `rejected`

This data helps measure AI accuracy and identify areas for policy improvement.

### Future: Ensemble Voting

The architecture is designed to support multiple policy agents voting on decisions:

```
Issue → [Multiple Skills in parallel] → Arbiter → Weighted Decision
```

Each skill would return a weighted vote, and an arbiter skill would combine them for the final decision.
