# Payment Processing Service

Automated payment issue processing service with decision engine and asynchronous job queue support. Built with TypeScript, Fastify, BullMQ, PostgreSQL, and Redis.

## Prerequisites

- Node.js >= 20.0.0
- PostgreSQL 16+
- Redis 7+

## Architecture & Design

### Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              DATA FLOW                                       │
└──────────────────────────────────────────────────────────────────────────────┘

  ┌────────┐      ┌─────────────┐      ┌─────────────┐      ┌──────────────┐
  │ Client │─────▶│  Fastify    │─────▶│   BullMQ    │─────▶│    Worker    │
  │        │      │  API Server │      │   Queue     │      │   Process    │
  └────────┘      └─────────────┘      └─────────────┘      └──────────────┘
                        │                    │                     │
                        │ validate &         │ persist             │ process
                        │ enqueue            │ jobs                │ issues
                        ▼                    ▼                     ▼
                  ┌──────────┐         ┌──────────┐         ┌──────────────┐
                  │PostgreSQL│         │  Redis   │         │   Decision   │
                  │          │         │          │         │    Engine    │
                  │ • issues │         │ • jobs   │         │              │
                  │ • audit  │         │ • state  │         │ rules │ AI   │
                  │ • analytics        │ • locks  │         └──────────────┘
                  └──────────┘         └──────────┘                │
                        ▲                                          │
                        └──────────────────────────────────────────┘
                                    update status & decision
```

**Request Lifecycle:**

1. **Client** submits issue via `POST /api/v1/issues`
2. **API Server** validates request, creates issue record (status: `pending`), enqueues job
3. **Queue** persists job to Redis with priority and retry configuration
4. **Worker** picks up job, updates status to `processing`, fetches context (customer, transaction)
5. **Decision Engine** evaluates issue using rules or AI, returns decision with confidence
6. **Worker** updates issue with decision, sets final status (`resolved`, `awaiting_review`, or `failed`)
7. **Client** polls `GET /api/v1/issues/:id` to check status and retrieve results

**Where State Lives:**

| Component | State | Persistence |
|-----------|-------|-------------|
| PostgreSQL | Issues, customers, transactions, audit logs, analytics | Durable, ACID |
| Redis | Job queue, job state, locks | Durable (AOF), lost on flush |
| Worker Memory | Current job context | Ephemeral, lost on crash |

**Component Responsibilities:**

| Component | Responsibility |
|-----------|----------------|
| API Server | Request validation, authentication (future), rate limiting, job enqueueing |
| Queue (BullMQ) | Job persistence, retry logic, priority ordering, concurrency control |
| Worker | Job processing, decision engine orchestration, status management |
| Decision Engine | Business logic evaluation, AI prompt construction, confidence scoring |
| Repositories | Data access, PII encryption/decryption, audit logging |

### Trade-offs & Decisions

#### Database Schema

The schema prioritizes **flexibility and compliance** over query simplicity. The `details` column uses JSONB to store issue-type-specific data (decline error codes, dispute reasons, installment info) rather than creating separate tables or nullable columns for each type. This allows adding new issue types without schema migrations, but sacrifices type safety at the database level—validation happens in the application via Zod schemas instead.

PII fields (customer email/name, payment methods) are encrypted at the application layer using AES-256-GCM rather than database-level encryption (like `pgcrypto`). This means encrypted data is opaque to PostgreSQL—we can't query by email or build indexes on names. The trade-off is worth it: application-level encryption lets us control key management, implement field-level access logging, and avoid exposing plaintext to database backups or admin tools. The `audit_logs` table is separate from `issues` to maintain a clean append-only compliance trail, though this means joining tables to correlate changes.

**Scaling to 10,000 issues/day:** At this volume (~7 issues/minute), the current schema would need adjustments. First, partition the `issues` table by `created_at` (monthly or weekly) to keep index sizes manageable and enable efficient archival. Second, move `audit_logs` to a time-series database (TimescaleDB, or a separate PostgreSQL instance) since audit volume grows faster than issues and has different query patterns (mostly time-range scans). Third, add read replicas for reporting queries (`decision_analytics` aggregations, issue listings) to avoid impacting write throughput. Finally, implement an archival job to move resolved issues older than the retention period to cold storage.

#### Queue Design

**Crash Recovery:** BullMQ provides strong guarantees for job durability. When the API enqueues a job, it's persisted to Redis before the HTTP response returns—if the API crashes after enqueueing, the job survives. If the worker crashes mid-processing, BullMQ's "active job" tracking detects the abandoned job and automatically moves it back to the waiting queue after a visibility timeout. The worker also updates the issue status to `processing` in PostgreSQL before starting work, so if a job is abandoned, we can identify stuck issues by querying for `status = 'processing'` with `updated_at` older than expected processing time.

The retry configuration (5 attempts with exponential backoff starting at 2 seconds) handles transient failures gracefully. Each retry is logged, and after exhausting retries, the job moves to the "failed" state where it can be manually inspected and requeued. The issue status is updated to `failed` with the error message preserved in the database.

**AI API Downtime:** If the Anthropic API is unavailable, jobs will retry with exponential backoff (2s → 4s → 8s → 16s → 32s) before failing after 5 attempts. During a 1-hour outage, most jobs would exhaust retries and fail. To improve resilience, we could add: (1) a circuit breaker that detects consecutive API failures and switches to a degraded mode (either fail-fast or fall back to rules-based decisions), (2) longer retry windows with more attempts for AI-mode jobs specifically, or (3) a "pause processing" mechanism that holds jobs in the queue without consuming retry attempts until the API recovers.

#### Agent Architecture

**Why Skill-Per-Policy:** We chose to implement each policy domain (decline, dispute, refund, installment) as a separate Claude skill file rather than a single monolithic prompt. This separation provides several benefits: each policy is self-contained and human-readable, making it easy for non-engineers (product managers, compliance officers) to review and suggest changes. Policy updates are isolated—changing refund rules doesn't risk breaking dispute handling. The skill files serve as living documentation of business logic, versioned alongside the code.

The router pattern (`decisionEngineRouter.ts`) examines the issue type and loads the appropriate skill, constructing a focused prompt with only the relevant policy. This keeps prompts concise (better AI performance, lower token costs) and makes debugging straightforward—we know exactly which policy was applied from the `policyApplied` field in the response.

**Single Agent Alternative:** A colleague might argue that a single "payment issue expert" agent with all policies in one prompt would be simpler—one file to maintain, no routing logic, potentially better cross-policy reasoning. This is valid for small policy sets, but becomes problematic as policies grow. A single prompt containing 4+ detailed policy documents would be harder to maintain, slower to iterate on, and more expensive per API call. The skill approach also positions us for future **ensemble voting**: multiple specialized agents could evaluate the same issue independently, with an arbiter combining their recommendations. This architecture is common in high-stakes decision systems where we want to catch edge cases that any single model might miss.

### What You'd Do Differently

With more time, these improvements would have the highest impact, in priority order:

1. **Authentication & Authorization** — The API currently has no authentication. Production would need API keys or JWT tokens, with role-based access control (e.g., only certain users can submit human reviews, only admins can view audit logs).

2. **Dead Letter Queue & Admin Visibility** — Failed jobs disappear into BullMQ's failed state with no easy way to inspect, retry, or alert on them. A dead letter queue with a simple admin UI would let operators see why jobs failed and retry them with one click.

3. **Metrics & Observability** — Add Prometheus metrics for job processing time, queue depth, decision engine latency, and AI API error rates. Integrate with Grafana for dashboards and PagerDuty for alerting on anomalies.

4. **Circuit Breaker for AI API** — Implement a circuit breaker (like `opossum`) that trips after N consecutive AI API failures, immediately failing new requests (or falling back to rules) instead of waiting for timeouts. This prevents queue backup during outages.

5. **Batch Processing** — For high-volume scenarios, process similar issues in batches. Multiple decline issues for the same customer could be evaluated together, reducing API calls and enabling cross-issue reasoning.

6. **Policy Versioning** — Track which version of each skill file was used for each decision. This enables A/B testing of policy changes and debugging why a specific decision was made weeks later.

7. **Event-Driven Notifications** — Emit events (via webhooks or message queue) when issues change status. External systems could subscribe to trigger customer notifications, update dashboards, or sync with support tools.

8. **Reviewer Dashboard** — Build a simple web UI for human reviewers to see the `awaiting_review` queue, view AI recommendations with reasoning, and submit decisions without using curl commands.

9. **Production Deployment Guide** — Document production deployment with build steps, environment configuration, process management (PM2/systemd), health checks, and scaling considerations.

## Local Development

### 1. Configure Environment

Copy the example environment file:

```bash
cp .env.example .env
```

Generate a secure encryption key for PII encryption (customer emails, names, payment methods are encrypted at rest):

```bash
openssl rand -hex 32
```

Copy the output and set it as `ENCRYPTION_KEY` in your `.env` file.

To use AI-powered decisions, get an API key from [Claude](https://platform.claude.com/dashboard) and configure:

```
ANTHROPIC_API_KEY=your-api-key-here
DECISION_ENGINE_MODE=ai
```

### 2. Start Infrastructure

Start PostgreSQL and Redis using Docker Compose:

```bash
docker-compose up -d
```

### 3. Install & Setup

Install dependencies and run migrations:

```bash
npm install
npm run db:migrate
```

### 4. Run the Service

Start the development server:

```bash
npm run dev
```

Start the worker (in a separate terminal):

```bash
npm run worker:dev
```

### 5. Test the Pipeline

Run the sample ingestion script to verify everything works:

```bash
npm run ingest-samples -- -c
```

The `-c` flag clears the database first. This script:

1. Seeds sample customers and transactions from `sample_data/`
2. Creates 6 payment issues via the API (declines, disputes, refunds, missed installments)
3. Waits for the worker to process each issue through the decision engine
4. Displays results showing the automated decision and routing

**Expected output:**

```
┌────────────────────┬────────────────────┬───────────────┬────────────┬───────────────┐
│ Issue ID           │ Type               │ Decision      │ Confidence │ Routing       │
├────────────────────┼────────────────────┼───────────────┼────────────┼───────────────┤
│ iss_001            │ decline            │ retry_payment │        85% │ auto_resolve  │
│ iss_002            │ missed_installment │ send_reminder │        75% │ human_review  │
│ iss_003            │ dispute            │      escalate │        40% │ escalate      │
│ ...                │ ...                │           ... │        ... │ ...           │
└────────────────────┴────────────────────┴───────────────┴────────────┴───────────────┘
```

Issues route based on confidence: ≥90% auto-resolves, 70-89% needs human review, <70% escalates.

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
