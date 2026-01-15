#!/usr/bin/env tsx
/**
 * Set up TimescaleDB features for the audit_logs table.
 *
 * This script:
 * 1. Enables the TimescaleDB extension
 * 2. Converts audit_logs to a hypertable for efficient time-series storage
 * 3. Sets up compression policy (compress chunks older than 7 days)
 * 4. Sets up retention policy (drop chunks older than 90 days)
 *
 * Usage:
 *   npm run setup-timescaledb
 *
 * Prerequisites:
 * - PostgreSQL must be running with TimescaleDB extension available
 * - Database migrations must have been run first (audit_logs table must exist)
 *
 * This script is idempotent - it can be run multiple times safely.
 */

import { sql } from 'drizzle-orm';
import { db, closeDatabase } from '../src/db/client.js';

async function main(): Promise<void> {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║            TimescaleDB Setup for Audit Logs                ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log();

  try {
    // Step 1: Enable TimescaleDB extension
    console.log('Step 1: Enabling TimescaleDB extension...');
    await db.execute(sql`CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE`);
    console.log('  ✓ TimescaleDB extension enabled');

    // Step 2: Check if audit_logs is already a hypertable
    console.log('\nStep 2: Checking audit_logs table...');
    const hypertableCheck = await db.execute(sql`
      SELECT * FROM timescaledb_information.hypertables
      WHERE hypertable_name = 'audit_logs'
    `);

    if (hypertableCheck.length > 0) {
      console.log('  ✓ audit_logs is already a hypertable');
    } else {
      // Convert to hypertable
      console.log('  Converting audit_logs to hypertable...');
      await db.execute(sql`
        SELECT create_hypertable('audit_logs', 'created_at',
          migrate_data => true,
          chunk_time_interval => INTERVAL '1 day'
        )
      `);
      console.log('  ✓ audit_logs converted to hypertable with 1-day chunks');
    }

    // Step 3: Set up compression
    console.log('\nStep 3: Setting up compression...');
    try {
      // Enable compression on the table
      await db.execute(sql`
        ALTER TABLE audit_logs SET (
          timescaledb.compress,
          timescaledb.compress_segmentby = 'entity_type,action'
        )
      `);
      console.log('  ✓ Compression enabled (segment by entity_type, action)');

      // Add compression policy (compress chunks older than 7 days)
      await db.execute(sql`
        SELECT add_compression_policy('audit_logs', INTERVAL '7 days', if_not_exists => true)
      `);
      console.log('  ✓ Compression policy: chunks older than 7 days');
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes('already exists')) {
        console.log('  ✓ Compression policy already exists');
      } else {
        throw error;
      }
    }

    // Step 4: Set up retention policy
    console.log('\nStep 4: Setting up retention policy...');
    try {
      await db.execute(sql`
        SELECT add_retention_policy('audit_logs', INTERVAL '90 days', if_not_exists => true)
      `);
      console.log('  ✓ Retention policy: drop chunks older than 90 days');
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes('already exists')) {
        console.log('  ✓ Retention policy already exists');
      } else {
        throw error;
      }
    }

    // Show final status
    console.log('\n' + '─'.repeat(60));
    console.log('Summary:');

    const chunkInfo = await db.execute(sql`
      SELECT count(*) as chunk_count,
             pg_size_pretty(sum(total_bytes)) as total_size
      FROM timescaledb_information.chunks
      WHERE hypertable_name = 'audit_logs'
    `);

    if (chunkInfo.length > 0) {
      const info = chunkInfo[0] as { chunk_count: string; total_size: string | null };
      console.log(`  Chunks: ${info.chunk_count}`);
      console.log(`  Total size: ${info.total_size || 'empty'}`);
    }

    console.log('\n✓ TimescaleDB setup complete!');
    console.log('\nNote: Compression and retention policies run automatically via TimescaleDB scheduler.');
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('extension "timescaledb" is not available')) {
        console.error('\n✗ TimescaleDB extension is not available.');
        console.error('  Make sure you are using the TimescaleDB Docker image:');
        console.error('  image: timescale/timescaledb:latest-pg16');
        process.exit(1);
      }
      if (error.message.includes('does not exist')) {
        console.error('\n✗ audit_logs table does not exist.');
        console.error('  Run database migrations first: npm run db:migrate');
        process.exit(1);
      }
    }
    console.error('\n✗ Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  } finally {
    await closeDatabase();
  }
}

main();
