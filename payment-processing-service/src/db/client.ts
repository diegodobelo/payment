import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';
import * as schema from './schema/index.js';

// Create the postgres connection
const connectionString = config.database.url;

// Create postgres client with connection pooling
const client = postgres(connectionString, {
  max: config.database.poolMax,
  idle_timeout: 30,
  connect_timeout: 10,
  onnotice: () => {}, // Suppress NOTICE messages
});

// Create drizzle instance with schema
export const db = drizzle(client, { schema });

// Export the raw client for migrations
export const sql = client;

/**
 * Close the database connection
 */
export async function closeDatabase(): Promise<void> {
  logger.info('Closing database connection');
  await client.end();
  logger.info('Database connection closed');
}

/**
 * Test database connection
 */
export async function testConnection(): Promise<boolean> {
  try {
    await client`SELECT 1`;
    return true;
  } catch (error) {
    logger.error({ error }, 'Database connection test failed');
    return false;
  }
}

export type Database = typeof db;
