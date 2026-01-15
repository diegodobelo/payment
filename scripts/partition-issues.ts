#!/usr/bin/env tsx
/**
 * Convert the issues table to a partitioned table by created_at.
 *
 * This script:
 * 1. Creates a new partitioned table structure
 * 2. Creates monthly partitions
 * 3. Migrates existing data
 * 4. Swaps the tables
 *
 * Usage:
 *   npm run partition-issues              # Create partitions and migrate
 *   npm run partition-issues -- --dry-run # Preview what would happen
 *   npm run partition-issues -- --create-future  # Only create future partitions
 *
 * IMPORTANT: This is a destructive migration. Back up your data first!
 *
 * After running this script, use create-partition.ts monthly to create new partitions.
 */

import { sql } from 'drizzle-orm';
import { db, closeDatabase } from '../src/db/client.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const createFutureOnly = args.includes('--create-future');

/**
 * Generate partition name from date.
 */
function getPartitionName(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `issues_y${year}m${month}`;
}

/**
 * Get the start of a month.
 */
function getMonthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

/**
 * Get the start of the next month.
 */
function getNextMonthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 1);
}

/**
 * Format date for SQL.
 */
function formatDate(date: Date): string {
  return date.toISOString().split('T')[0]!;
}

async function checkIfPartitioned(): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT relkind FROM pg_class
    WHERE relname = 'issues'
  `);

  if (result.length === 0) return false;
  // 'p' = partitioned table, 'r' = regular table
  return (result[0] as { relkind: string }).relkind === 'p';
}

async function createPartition(
  partitionName: string,
  startDate: Date,
  endDate: Date,
  tableName = 'issues'
): Promise<boolean> {
  const startStr = formatDate(startDate);
  const endStr = formatDate(endDate);

  // Check if partition already exists
  const exists = await db.execute(sql.raw(`
    SELECT 1 FROM pg_class WHERE relname = '${partitionName}'
  `));

  if (exists.length > 0) {
    console.log(`  Partition ${partitionName} already exists`);
    return false;
  }

  if (dryRun) {
    console.log(`  Would create: ${partitionName} (${startStr} to ${endStr})`);
    return true;
  }

  await db.execute(sql.raw(`
    CREATE TABLE ${partitionName} PARTITION OF ${tableName}
      FOR VALUES FROM ('${startStr}') TO ('${endStr}')
  `));

  console.log(`  ✓ Created partition: ${partitionName} (${startStr} to ${endStr})`);
  return true;
}

async function createFuturePartitions(months = 12): Promise<void> {
  console.log(`\nCreating partitions for next ${months} months...`);

  const now = new Date();
  let created = 0;

  for (let i = 0; i <= months; i++) {
    const date = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const partitionName = getPartitionName(date);
    const startDate = getMonthStart(date);
    const endDate = getNextMonthStart(date);

    if (await createPartition(partitionName, startDate, endDate)) {
      created++;
    }
  }

  console.log(`\nCreated ${created} new partitions`);
}

async function migrateToPartitioned(): Promise<void> {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║           Issues Table Partitioning Migration              ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log();

  if (dryRun) {
    console.log('DRY RUN MODE - No changes will be made\n');
  }

  // Check if already partitioned
  const isPartitioned = await checkIfPartitioned();
  if (isPartitioned) {
    console.log('Issues table is already partitioned.');
    if (createFutureOnly) {
      await createFuturePartitions();
    } else {
      console.log('Use --create-future to create additional partitions.');
    }
    return;
  }

  // Get current row count
  const [countResult] = await db.execute(sql`SELECT count(*)::int as count FROM issues`);
  const rowCount = (countResult as { count: number }).count;
  console.log(`Current issues table: ${rowCount.toLocaleString()} rows\n`);

  // Find date range of existing data
  const [dateRange] = await db.execute(sql`
    SELECT min(created_at) as min_date, max(created_at) as max_date FROM issues
  `);
  const minDate = (dateRange as { min_date: Date | null }).min_date;
  const maxDate = (dateRange as { max_date: Date | null }).max_date;

  if (minDate) {
    console.log(`Data range: ${minDate.toISOString()} to ${maxDate?.toISOString()}`);
  }

  if (dryRun) {
    console.log('\nWould perform the following steps:');
    console.log('1. Create partitioned table issues_partitioned');
    console.log('2. Create monthly partitions from data start to 12 months ahead');
    console.log('3. Migrate data from issues to issues_partitioned');
    console.log('4. Rename issues -> issues_old');
    console.log('5. Rename issues_partitioned -> issues');
    console.log('6. Drop issues_old (after verification)');
    console.log('\nRun without --dry-run to execute.');
    return;
  }

  console.log('\nStep 1: Creating partitioned table structure...');

  // Create the partitioned table with same structure
  await db.execute(sql`
    CREATE TABLE issues_partitioned (
      id uuid NOT NULL,
      external_id varchar(50) NOT NULL,
      type issue_type NOT NULL,
      status issue_status NOT NULL DEFAULT 'pending',
      priority priority_level NOT NULL DEFAULT 'normal',
      customer_id uuid NOT NULL,
      transaction_id uuid NOT NULL,
      details jsonb NOT NULL,
      retry_count integer NOT NULL DEFAULT 0,
      last_retry_at timestamp with time zone,
      automated_decision decision_type,
      automated_decision_confidence decimal(3,2),
      automated_decision_reason text,
      human_decision decision_type,
      human_decision_reason text,
      human_reviewer_email varchar(255),
      human_reviewed_at timestamp with time zone,
      final_resolution varchar(50),
      resolution_reason text,
      idempotency_key varchar(100),
      created_at timestamp with time zone NOT NULL DEFAULT now(),
      updated_at timestamp with time zone NOT NULL DEFAULT now(),
      resolved_at timestamp with time zone,
      PRIMARY KEY (id, created_at)
    ) PARTITION BY RANGE (created_at)
  `);
  console.log('  ✓ Created partitioned table structure');

  // Step 2: Create partitions
  console.log('\nStep 2: Creating partitions...');

  // Determine partition range
  const startMonth = minDate ? getMonthStart(minDate) : getMonthStart(new Date());
  const endMonth = new Date();
  endMonth.setMonth(endMonth.getMonth() + 12); // 12 months ahead

  let current = new Date(startMonth);
  let partitionsCreated = 0;

  while (current <= endMonth) {
    const partitionName = getPartitionName(current);
    const startDate = getMonthStart(current);
    const endDate = getNextMonthStart(current);

    await createPartition(partitionName, startDate, endDate, 'issues_partitioned');
    partitionsCreated++;

    current = getNextMonthStart(current);
  }

  console.log(`\n  Created ${partitionsCreated} partitions`);

  // Step 3: Migrate data
  if (rowCount > 0) {
    console.log('\nStep 3: Migrating data...');
    const startTime = Date.now();

    await db.execute(sql`
      INSERT INTO issues_partitioned
      SELECT * FROM issues
    `);

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`  ✓ Migrated ${rowCount.toLocaleString()} rows in ${duration}s`);
  } else {
    console.log('\nStep 3: No data to migrate');
  }

  // Step 4: Swap tables
  console.log('\nStep 4: Swapping tables...');

  // Create indexes on the partitioned table
  await db.execute(sql`CREATE UNIQUE INDEX idx_issues_part_external_id ON issues_partitioned(external_id)`);
  await db.execute(sql`CREATE INDEX idx_issues_part_status ON issues_partitioned(status)`);
  await db.execute(sql`CREATE INDEX idx_issues_part_type ON issues_partitioned(type)`);
  await db.execute(sql`CREATE INDEX idx_issues_part_customer ON issues_partitioned(customer_id)`);
  await db.execute(sql`CREATE INDEX idx_issues_part_transaction ON issues_partitioned(transaction_id)`);
  await db.execute(sql`CREATE INDEX idx_issues_part_created ON issues_partitioned(created_at)`);
  await db.execute(sql`CREATE INDEX idx_issues_part_priority_created ON issues_partitioned(priority, created_at)`);
  await db.execute(sql`CREATE UNIQUE INDEX idx_issues_part_idempotency ON issues_partitioned(idempotency_key) WHERE idempotency_key IS NOT NULL`);

  // Add foreign key constraints
  await db.execute(sql`
    ALTER TABLE issues_partitioned
    ADD CONSTRAINT fk_issues_part_customer FOREIGN KEY (customer_id) REFERENCES customers(id)
  `);
  await db.execute(sql`
    ALTER TABLE issues_partitioned
    ADD CONSTRAINT fk_issues_part_transaction FOREIGN KEY (transaction_id) REFERENCES transactions(id)
  `);

  console.log('  ✓ Created indexes and constraints');

  // Rename tables
  await db.execute(sql`ALTER TABLE issues RENAME TO issues_old`);
  await db.execute(sql`ALTER TABLE issues_partitioned RENAME TO issues`);
  console.log('  ✓ Tables swapped');

  // Step 5: Verify and cleanup
  console.log('\nStep 5: Verification...');
  const [newCount] = await db.execute(sql`SELECT count(*)::int as count FROM issues`);
  const newRowCount = (newCount as { count: number }).count;

  if (newRowCount === rowCount) {
    console.log(`  ✓ Row count verified: ${newRowCount.toLocaleString()}`);

    // Drop old table
    await db.execute(sql`DROP TABLE issues_old CASCADE`);
    console.log('  ✓ Dropped old table');
  } else {
    console.error(`  ✗ Row count mismatch! Expected ${rowCount}, got ${newRowCount}`);
    console.error('  Old table preserved as issues_old for investigation');
  }

  console.log('\n' + '═'.repeat(60));
  console.log('✓ Partitioning complete!');
  console.log('\nNext steps:');
  console.log('  - Set up a monthly cron job to create future partitions');
  console.log('  - Run: npm run partition-issues -- --create-future');
}

async function main(): Promise<void> {
  try {
    if (createFutureOnly) {
      // Just create future partitions for an already-partitioned table
      const isPartitioned = await checkIfPartitioned();
      if (!isPartitioned) {
        console.error('Issues table is not partitioned yet. Run without --create-future first.');
        process.exit(1);
      }
      await createFuturePartitions();
    } else {
      await migrateToPartitioned();
    }
  } catch (error) {
    console.error('\n✗ Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  } finally {
    await closeDatabase();
  }
}

main();
