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
                        │ create issue       │ persist             │ process
                        │ & enqueue          │ jobs                │ issues
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
5. **Decision Engine** evaluates issue using local rules or AI, returns decision with confidence
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

### Database Schema

Schema defined using [Drizzle ORM](https://orm.drizzle.team/) in `src/db/schema/`.

```
┌─────────────┐       ┌──────────────┐       ┌─────────────────┐
│  customers  │───┐   │ transactions │───┐   │     issues      │
├─────────────┤   │   ├──────────────┤   │   ├─────────────────┤
│ id (PK)     │   │   │ id (PK)      │   │   │ id (PK)         │
│ external_id │   │   │ external_id  │   │   │ external_id     │
│ email_enc   │   └──▶│ customer_id  │   └──▶│ customer_id     │
│ name_enc    │       │ merchant     │       │ transaction_id  │
│ risk_score  │       │ amount       │       │ type            │
│ ...         │       │ status       │       │ status          │
└─────────────┘       │ ...          │       │ details (JSONB) │
                      └──────────────┘       │ decisions...    │
                                             └────────┬────────┘
                                                      │
                      ┌──────────────────────────────┬┴─────────────────┐
                      ▼                              ▼                  ▼
              ┌───────────────┐           ┌─────────────────┐  ┌───────────────────┐
              │status_history │           │   audit_logs    │  │decision_analytics │
              ├───────────────┤           ├─────────────────┤  ├───────────────────┤
              │ id (PK)       │           │ id (PK)         │  │ id (PK)           │
              │ issue_id (FK) │           │ entity_type     │  │ issue_id (FK)     │
              │ from_status   │           │ entity_id       │  │ ai_decision       │
              │ to_status     │           │ action          │  │ human_decision    │
              │ changed_by    │           │ actor           │  │ agreement         │
              └───────────────┘           │ changes (JSONB) │  └───────────────────┘
                                          └─────────────────┘
```

**Tables:**

| Table | Purpose |
|-------|---------|
| `customers` | Customer profiles with encrypted PII (email, name) and risk scoring |
| `transactions` | Payment transactions with installment plans and shipping info (JSONB) |
| `issues` | Payment issues—the core entity with type-specific details (JSONB) |
| `status_history` | Audit trail of issue status transitions |
| `audit_logs` | Compliance logging for all data access and modifications |
| `decision_analytics` | Tracks AI vs human decisions for accuracy measurement |
| `issues_archive` | Cold storage for resolved issues (partitioned by date) |

**Key Enums:**

| Enum | Values |
|------|--------|
| `issue_type` | `decline`, `missed_installment`, `dispute`, `refund_request` |
| `issue_status` | `pending`, `processing`, `awaiting_review`, `resolved`, `failed` |
| `decision_type` | `retry_payment`, `block_card`, `approve_refund`, `deny_refund`, `accept_dispute`, `contest_dispute`, `send_reminder`, `charge_late_fee`, `escalate` |
| `priority_level` | `low`, `normal`, `high`, `critical` |

### Trade-offs & Decisions

#### Schema Design

The schema prioritizes **flexibility and compliance** over query simplicity. The `details` column uses JSONB to store issue-type-specific data (decline error codes, dispute reasons, installment info) rather than creating separate tables or nullable columns for each type. This allows adding new issue types without schema migrations, but sacrifices type safety at the database level—validation happens in the application via Zod schemas instead.

PII fields (customer email/name, payment methods) are encrypted at the application layer using AES-256-GCM rather than database-level encryption (like `pgcrypto`). This means encrypted data is opaque to PostgreSQL—we can't query by email or build indexes on names. The trade-off is worth it: application-level encryption lets us control key management, implement field-level access logging, and avoid exposing plaintext to database backups or admin tools. The `audit_logs` table is separate from `issues` to maintain a clean append-only compliance trail, though this means joining tables to correlate changes.

**Scaling to 10,000 issues/day:** At this volume (~7 issues/minute), the service includes infrastructure for scaling (see [Database Scaling](#database-scaling)): table partitioning by `created_at` for efficient queries on recent data, automatic retention policies for audit logs, read replica support for reporting queries, and scheduled archival jobs that move resolved issues to cold storage and purge old archives. These features run automatically via the worker process.

#### Queue Design

**Crash Recovery:** BullMQ provides strong guarantees for job durability. When the API enqueues a job, it's persisted to Redis before the HTTP response returns—if the API crashes after enqueueing, the job survives. If the worker crashes mid-processing, BullMQ's "active job" tracking detects the abandoned job and automatically moves it back to the waiting queue after a visibility timeout. The worker also updates the issue status to `processing` in PostgreSQL before starting work, so if a job is abandoned, we can identify stuck issues by querying for `status = 'processing'` with `updated_at` older than expected processing time.

The retry configuration (5 attempts with exponential backoff starting at 2 seconds) handles transient failures gracefully. Each retry is logged, and after exhausting retries, the job moves to the "failed" state where it can be manually inspected and requeued. The issue status is updated to `failed` with the error message preserved in the database.

**AI API Downtime:** If the Anthropic API is unavailable, jobs will retry with exponential backoff (2s → 4s → 8s → 16s → 32s) before failing after 5 attempts. During a 1-hour outage, most jobs would exhaust retries and fail. To improve resilience, we could add: (1) a circuit breaker that detects consecutive API failures and switches to a degraded mode (either fail-fast or fall back to local rules-based decisions), (2) longer retry windows with more attempts for AI-mode jobs specifically, or (3) a "pause processing" mechanism that holds jobs in the queue without consuming retry attempts until the API recovers.

#### Scaling

**Processing Throughput:**

| Mode | Per Issue | 1 Worker (5 concurrent) | Max/Day |
|------|-----------|-------------------------|---------|
| Local Rules | ~100ms | 3,000/min | 4.3M |
| AI | ~10s | 30/min | 43,200 |

At 10,000 issues/day (~7/minute average), a single worker handles the load comfortably in either mode. AI mode would process the full day's issues in ~5.5 hours, leaving headroom for traffic spikes.

**Horizontal Scaling:**

Workers scale horizontally—each additional worker process adds 5 concurrent jobs. For higher throughput or redundancy:

```bash
# Terminal 1
npm run worker

# Terminal 2 (separate machine or container)
npm run worker
```

Two workers double throughput to 60 issues/minute (AI) or 6,000/minute (local rules). In production, run workers as separate containers/pods with health checks.

**Database Scaling:**

For query performance at scale, the service includes table partitioning, automatic archival, and read replica support. See [Database Scaling](#database-scaling) for configuration.

#### Agent Architecture

The service supports two decision engine modes: **local rules-based** and **AI-powered**. The mode is controlled by the `DECISION_ENGINE_MODE` environment variable.

```
Issue → Router → [Specialized Agent + Skill] → Decision
                        ↓
              Uses: decline-policy.md
                    dispute-policy.md
                    refund-policy.md
                    installment-policy.md
```

This service uses [Claude Agent Skills](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview) to implement its AI decision engine. Skills are folders of instructions, scripts, and resources that Claude loads dynamically to perform specialized tasks. They teach Claude how to complete specific tasks in a repeatable way—in this case, evaluating payment issues according to business policies.

The Skills specification is published as an [open standard](https://agentskills.io), meaning skills aren't locked to Claude and can work across AI platforms that adopt the standard.

##### Why Skills?

We chose to implement each policy domain (decline, dispute, refund, installment) as a separate Claude skill file rather than a single monolithic prompt. This separation provides several benefits: each policy is self-contained and human-readable, making it easy for non-engineers (product managers, compliance officers) to review and suggest changes. Policy updates are isolated—changing refund rules doesn't risk breaking dispute handling. The skill files serve as living documentation of business logic, versioned alongside the code.

The router pattern (`decisionEngineRouter.ts`) examines the issue type and loads the appropriate skill, constructing a focused prompt with only the relevant policy. This keeps prompts concise (better AI performance, lower token costs) and makes debugging straightforward—we know exactly which policy was applied from the `policyApplied` field in the response.

1. **Separation of concerns** - Each policy domain is a self-contained markdown file
2. **Easy to update** - Policy changes require editing a skill file, not code
3. **No code deployment for policy updates** - Skills are loaded at runtime
4. **Human readable** - Non-engineers can review and suggest policy changes
5. **Future-ready for ensemble voting** - Each skill can become a voting agent

##### Skill Files

Skills are stored in `.claude/skills/`:

| Skill | Purpose |
|-------|---------|
| `decline-policy.md` | Handles payment decline issues (insufficient funds, expired card) |
| `dispute-policy.md` | Handles customer disputes (item not received, unauthorized) |
| `refund-policy.md` | Handles refund requests (changed mind, defective) |
| `installment-policy.md` | Handles missed installment payments |

##### Confidence-Based Routing

| Confidence | Action |
|------------|--------|
| ≥ 90% | Auto-execute the recommendation |
| 70-89% | Queue for human review |
| < 70% | Queue for human decision (escalate) |

##### Error Handling & Resilience

The system is designed to be resilient to AI failures. Jobs that fail are automatically retried with exponential backoff:

```typescript
defaultJobOptions: {
  attempts: config.queue.maxRetries,     // Default: 3 attempts
  backoff: {
    type: 'exponential',
    delay: config.queue.backoffDelayMs,  // e.g., 2s → 4s → 8s
  },
}
```

##### Fallback to Local Rules Engine

If the AI API fails or times out, the system automatically falls back to the local rules-based engine:

```typescript
if (mode === 'ai') {
  try {
    const aiDecision = await evaluateWithAI(issue, customer, transaction);
    return aiDecisionToUnified(aiDecision);
  } catch (error) {
    log.error({ err: error }, 'AI decision engine failed, falling back to rules');
    const rulesDecision = evaluateWithRules(issue, customer, transaction);
    return rulesDecisionToUnified(rulesDecision);
  }
}
```

##### Non-Retryable Errors

Some errors skip retries entirely (`NonRetryableError`):
- Issue not found
- Customer not found
- Transaction not found

These are data problems that won't be fixed by retrying.

##### Failure Recovery Flow

```
AI Request
    ↓
[Timeout/Error?] ──Yes──▶ Fallback to Local Rules Engine ──▶ Continue Processing
    │
   No
    ↓
[Success] ──▶ Continue Processing
    ↓
[Job-level failure?] ──Yes──▶ BullMQ retries (exponential backoff)
    │                              ↓
   No                    [All retries exhausted?] ──▶ Job marked as failed
    ↓
 Done
```

This ensures AI failures don't block processing—the local rules engine provides a deterministic fallback.

##### Switching Between Modes

**Local rules mode (default):**
```bash
DECISION_ENGINE_MODE=rules
```

**AI mode:**
```bash
DECISION_ENGINE_MODE=ai
ANTHROPIC_API_KEY=your-api-key
```

**Single Agent Alternative:** A colleague might argue that a single "payment issue expert" agent with all policies in one prompt would be simpler—one file to maintain, no routing logic, potentially better cross-policy reasoning. This is valid for small policy sets, but becomes problematic as policies grow. A single prompt containing 4+ detailed policy documents would be harder to maintain, slower to iterate on, and more expensive per API call. The skill approach also positions us for future **ensemble voting**: multiple specialized agents could evaluate the same issue independently, with an arbiter combining their recommendations. This architecture is common in high-stakes decision systems where we want to catch edge cases that any single model might miss.

### Future work

With more time, these improvements would have the highest impact, in priority order:

1. **Authentication & Authorization** — The API currently has no authentication. Production would need API keys or JWT tokens, with role-based access control (e.g., only certain users can submit human reviews, only admins can view audit logs).

2. **Dead Letter Queue & Admin Visibility** — Failed jobs disappear into BullMQ's failed state with no easy way to inspect, retry, or alert on them. A dead letter queue with a simple admin UI would let operators see why jobs failed and retry them with one click.

3. **Metrics & Observability** — Add Prometheus metrics for job processing time, queue depth, decision engine latency, and AI API error rates. Integrate with Grafana for dashboards and PagerDuty for alerting on anomalies, for example.

4. **Circuit Breaker for AI API** — Implement a circuit breaker (like `opossum`) that trips after N consecutive AI API failures, immediately failing new requests (or falling back to local rules) instead of waiting for timeouts. This prevents queue backup during outages.

5. **Batch Processing** — For high-volume scenarios, process similar issues in batches. Multiple decline issues for the same customer could be evaluated together, reducing API calls and enabling cross-issue reasoning.

6. **Policy Versioning** — Track which version of each skill file was used for each decision. This enables A/B testing of policy changes and debugging why a specific decision was made weeks later.

7. **Event-Driven Notifications** — Emit events (via webhooks or message queue) when issues change status. External systems could subscribe to trigger customer notifications, update dashboards, or sync with support tools.

8. **Production Deployment Guide** — Document production deployment with build steps, environment configuration, process management (PM2/systemd), health checks, and scaling considerations.

9. **Future: Ensemble Voting** - The architecture is designed to support multiple policy agents voting on decisions:

```
Issue → [Multiple Skills in parallel] → Arbiter → Weighted Decision
```

Each skill would return a weighted vote, and an arbiter skill would combine them for the final decision.

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

### 5. Run the Web Dashboard (Optional)

Start the Next.js frontend for reviewing issues (in a separate terminal):

```bash
cd web
npm install
npm run dev
```

Open http://localhost:3001 to access the dashboard. Features:
- View paginated list of issues with status/type filters
- Click an issue to see full details and processing history
- Submit human reviews for issues in `awaiting_review` status

### 6. Test the Pipeline

Run the sample ingestion script to verify everything works:

```bash
npm run ingest-samples -- -c
```

The `-c` flag clears the database first. This script:

1. Seeds sample customers and transactions from `sample_data/`
2. Creates 5 payment issues via the API (declines, disputes, refunds, missed installments)
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
| `npm run ingest-samples` | Run sample issues through end-to-end pipeline |
| `npm run archive-issues` | Archive resolved issues to cold storage |
| `npm run partition-issues` | Partition issues table for scaling |

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

## Database Scaling

For high-volume deployments (10,000+ issues/day), the service includes infrastructure for scaling:

### Issue Archival

Move old resolved issues to an archive table to keep the main `issues` table performant.

**Automatic:** The worker runs archival daily at 2 AM (configurable via `MAINTENANCE_ARCHIVE_SCHEDULE`). Archives older than 2 years are automatically purged.

**Manual:** Run archival on-demand:

```bash
# Archive issues resolved more than 30 days ago
npm run archive-issues

# Preview what would be archived
npm run archive-issues -- --dry-run

# Archive issues older than 60 days
npm run archive-issues -- -d 60

# Also purge archives older than 2 years
npm run archive-issues -- --purge

# Show archive statistics
npm run archive-issues -- --stats
```

Archived issues are preserved in `issues_archive` for compliance and can still be queried.

### Audit Log Retention

Audit logs are automatically purged after 90 days (configurable via `MAINTENANCE_AUDIT_LOGS_RETENTION_DAYS`). The worker runs the purge job daily at 3 AM by default.

### Table Partitioning

Partition the `issues` table by `created_at` for efficient queries on recent data.

**Initial setup** (one-time migration):

```bash
# Preview without making changes
npm run partition-issues -- --dry-run

# Migrate existing table to partitioned structure
npm run partition-issues
```

**Automatic:** Once partitioned, the worker creates future partitions on the 1st of each month (configurable via `MAINTENANCE_PARTITION_SCHEDULE`).

**Manual:** Create partitions on-demand:

```bash
npm run partition-issues -- --create-future
```

### Read Replicas

A read replica is a read-only copy of your database that stays synchronized with the primary. By directing analytics and reporting queries to the replica, you prevent heavy read operations from slowing down writes on the main database.

Configure a replica by setting:

```env
DATABASE_REPLICA_URL=postgresql://user:pass@replica-host:5432/payment_issues
```

The `decisionAnalyticsRepository` automatically uses the replica for aggregation queries when configured.

**Production setup:** Use PostgreSQL streaming replication or a managed service (AWS RDS, Cloud SQL) that provides read replicas.

**Local development:** This is optional—the service falls back to the primary database if no replica is configured.

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
| `DATABASE_REPLICA_URL` | Read replica connection (optional, for reporting queries) | - |
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

### Maintenance Jobs

| Variable | Description | Default |
|----------|-------------|---------|
| `MAINTENANCE_ENABLED` | Enable scheduled maintenance jobs | `true` |
| `MAINTENANCE_ARCHIVE_OLDER_THAN_DAYS` | Archive issues older than N days | `30` |
| `MAINTENANCE_ARCHIVE_PURGE_AFTER_DAYS` | Purge archives older than N days | `730` (2 years) |
| `MAINTENANCE_ARCHIVE_SCHEDULE` | Cron schedule for archival | `0 2 * * *` (daily 2 AM) |
| `MAINTENANCE_PARTITION_SCHEDULE` | Cron schedule for partition creation | `0 3 1 * *` (1st of month 3 AM) |
| `MAINTENANCE_AUDIT_LOGS_RETENTION_DAYS` | Delete audit logs older than N days | `90` |
| `MAINTENANCE_AUDIT_LOGS_SCHEDULE` | Cron schedule for audit log purge | `0 3 * * *` (daily 3 AM) |

## Libraries

### Backend

| Library | Purpose |
|---------|---------|
| [Fastify](https://fastify.dev/) | High-performance web framework. Chosen over Express for its speed, built-in validation, and first-class TypeScript support. |
| [BullMQ](https://bullmq.io/) | Redis-based job queue for background processing. Provides retries, priorities, rate limiting, and job persistence. |
| [Drizzle ORM](https://orm.drizzle.team/) | TypeScript ORM with type-safe queries. Lightweight alternative to Prisma with better SQL control. |
| [Zod](https://zod.dev/) | Schema validation library. Used for request validation, environment config, and type inference. |
| [Pino](https://getpino.io/) | Fast JSON logger. Low overhead, structured logging with automatic redaction of sensitive fields. |
| [ioredis](https://github.com/redis/ioredis) | Redis client for Node.js. Used by BullMQ for job queue persistence. |
| [postgres](https://github.com/porsager/postgres) | PostgreSQL client. Fast, lightweight driver used with Drizzle ORM. |
| [@anthropic-ai/claude-agent-sdk](https://github.com/anthropics/claude-code/tree/main/agent-sdk) | Claude Agent SDK for AI-powered decisions. Enables skill-based prompting and structured responses. |
| [@fastify/swagger](https://github.com/fastify/fastify-swagger) | OpenAPI documentation generator. Auto-generates API docs from route schemas. |
| [@fastify/rate-limit](https://github.com/fastify/fastify-rate-limit) | Rate limiting middleware. Protects API from abuse. |
| [dotenv](https://github.com/motdotla/dotenv) | Environment variable loader. Loads `.env` files in development. |

### Frontend (Web Dashboard)

| Library | Purpose |
|---------|---------|
| [Next.js](https://nextjs.org/) | React framework with App Router. Server components for data fetching, file-based routing. |
| [React](https://react.dev/) | UI library. Version 19 with server components support. |
| [Tailwind CSS](https://tailwindcss.com/) | Utility-first CSS framework. Rapid styling without custom CSS. |
| [Radix UI](https://www.radix-ui.com/) | Headless UI components. Accessible primitives for selects, labels, and other form elements. |
| [Lucide React](https://lucide.dev/) | Icon library. Clean, consistent SVG icons. |
| [clsx](https://github.com/lukeed/clsx) / [tailwind-merge](https://github.com/dcastil/tailwind-merge) | Utility for conditional class names and merging Tailwind classes. |

### Development Tools

| Library | Purpose |
|---------|---------|
| [TypeScript](https://www.typescriptlang.org/) | Static typing for JavaScript. Catches errors at compile time. |
| [Vitest](https://vitest.dev/) | Test runner. Fast, ESM-native, compatible with Jest API. |
| [tsx](https://github.com/privatenumber/tsx) | TypeScript executor. Runs `.ts` files directly without compilation step. |
| [Drizzle Kit](https://orm.drizzle.team/kit-docs/overview) | Database migration tool. Generates and applies schema migrations. |
| [ESLint](https://eslint.org/) | Linter for JavaScript/TypeScript. Enforces code quality rules. |
