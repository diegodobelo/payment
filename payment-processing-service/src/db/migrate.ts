import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db, closeDatabase } from './client.js';
import { logger } from '../lib/logger.js';

async function runMigrations(): Promise<void> {
  logger.info('Running database migrations...');

  try {
    await migrate(db, {
      migrationsFolder: './src/db/migrations',
    });
    logger.info('Migrations completed successfully');
  } catch (error) {
    logger.error({ error }, 'Migration failed');
    throw error;
  } finally {
    await closeDatabase();
  }
}

runMigrations().catch((error) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
