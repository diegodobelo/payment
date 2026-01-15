import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { logger } from '../lib/logger.js';

/**
 * Result of partition creation.
 */
export interface PartitionResult {
  created: number;
  skipped: number;
  errors: string[];
}

/**
 * Get partition name from date.
 */
function getPartitionName(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `issues_y${year}m${month}`;
}

/**
 * Format date for SQL.
 */
function formatDate(date: Date): string {
  return date.toISOString().split('T')[0]!;
}

/**
 * Check if the issues table is partitioned.
 */
export async function isTablePartitioned(): Promise<boolean> {
  try {
    const result = await db.execute(sql`
      SELECT relkind FROM pg_class
      WHERE relname = 'issues'
    `);

    if (result.length === 0) return false;
    // 'p' = partitioned table, 'r' = regular table
    return (result[0] as { relkind: string }).relkind === 'p';
  } catch {
    return false;
  }
}

/**
 * Check if a partition exists.
 */
async function partitionExists(partitionName: string): Promise<boolean> {
  const result = await db.execute(
    sql.raw(`SELECT 1 FROM pg_class WHERE relname = '${partitionName}'`)
  );
  return result.length > 0;
}

/**
 * Create a single partition.
 */
async function createPartition(
  partitionName: string,
  startDate: Date,
  endDate: Date
): Promise<boolean> {
  const startStr = formatDate(startDate);
  const endStr = formatDate(endDate);

  await db.execute(
    sql.raw(`
      CREATE TABLE ${partitionName} PARTITION OF issues
        FOR VALUES FROM ('${startStr}') TO ('${endStr}')
    `)
  );

  return true;
}

/**
 * Create partitions for the next N months.
 *
 * @param monthsAhead - Number of months to create partitions for (default: 3)
 * @returns Summary of created partitions
 */
export async function createFuturePartitions(
  monthsAhead = 3
): Promise<PartitionResult> {
  const log = logger.child({
    operation: 'createFuturePartitions',
    monthsAhead,
  });

  log.info('Checking for partition creation');

  // Check if table is partitioned
  const isPartitioned = await isTablePartitioned();
  if (!isPartitioned) {
    log.info('Issues table is not partitioned, skipping');
    return { created: 0, skipped: 0, errors: [] };
  }

  let created = 0;
  let skipped = 0;
  const errors: string[] = [];

  const now = new Date();

  for (let i = 0; i <= monthsAhead; i++) {
    const date = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const partitionName = getPartitionName(date);
    const startDate = new Date(date.getFullYear(), date.getMonth(), 1);
    const endDate = new Date(date.getFullYear(), date.getMonth() + 1, 1);

    try {
      const exists = await partitionExists(partitionName);
      if (exists) {
        log.debug({ partitionName }, 'Partition already exists');
        skipped++;
        continue;
      }

      await createPartition(partitionName, startDate, endDate);
      log.info(
        {
          partitionName,
          range: `${formatDate(startDate)} to ${formatDate(endDate)}`,
        },
        'Created partition'
      );
      created++;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      log.error({ partitionName, error: errorMessage }, 'Failed to create partition');
      errors.push(`${partitionName}: ${errorMessage}`);
    }
  }

  log.info({ created, skipped, errorCount: errors.length }, 'Partition creation complete');

  return { created, skipped, errors };
}
