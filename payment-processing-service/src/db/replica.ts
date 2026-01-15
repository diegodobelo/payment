import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';
import * as schema from './schema/index.js';

/**
 * Read replica database client.
 *
 * Uses the replica URL if configured, otherwise falls back to the primary.
 * This allows reporting/analytics queries to run on a replica without
 * impacting write performance on the primary.
 */

// Use replica URL if available, otherwise fall back to primary
const replicaUrl = config.database.replicaUrl || config.database.url;
const isUsingReplica = !!config.database.replicaUrl;

if (isUsingReplica) {
  logger.info('Read replica configured, using separate connection pool');
} else {
  logger.debug('No read replica configured, using primary database');
}

// Create postgres client with connection pooling
const replicaClient = postgres(replicaUrl, {
  max: config.database.poolMax,
  idle_timeout: 30,
  connect_timeout: 10,
  onnotice: () => {}, // Suppress NOTICE messages
});

// Create drizzle instance with schema
export const dbReplica = drizzle(replicaClient, { schema });

/**
 * Check if a separate replica is configured.
 */
export function hasReplica(): boolean {
  return isUsingReplica;
}

/**
 * Close the replica database connection.
 */
export async function closeReplicaDatabase(): Promise<void> {
  // Only close if using a separate replica connection
  if (isUsingReplica) {
    logger.info('Closing replica database connection');
    await replicaClient.end();
    logger.info('Replica database connection closed');
  }
}

/**
 * Test replica database connection.
 */
export async function testReplicaConnection(): Promise<boolean> {
  try {
    await replicaClient`SELECT 1`;
    return true;
  } catch (error) {
    logger.error({ error }, 'Replica database connection test failed');
    return false;
  }
}
