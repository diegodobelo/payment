#!/usr/bin/env tsx
/**
 * Archive resolved issues to keep the main issues table performant.
 *
 * Usage:
 *   npm run archive-issues              # Archive issues older than 30 days
 *   npm run archive-issues -- -d 60     # Archive issues older than 60 days
 *   npm run archive-issues -- --stats   # Show archive statistics only
 *   npm run archive-issues -- --dry-run # Preview what would be archived
 *   npm run archive-issues -- --purge   # Also purge old archives (default: 2 years)
 *   npm run archive-issues -- --purge-days 365  # Purge archives older than 365 days
 */

import '../src/config/index.js'; // Load config for environment validation
import { closeDatabase } from '../src/db/client.js';
import {
  archiveResolvedIssues,
  purgeOldArchives,
  getArchiveStats,
} from '../src/services/archivalService.js';
import { db } from '../src/db/client.js';
import { issues, issuesArchive } from '../src/db/schema/index.js';
import { inArray, lt, and, sql } from 'drizzle-orm';

// Parse command line arguments
const args = process.argv.slice(2);
const showStats = args.includes('--stats');
const dryRun = args.includes('--dry-run');
const runPurge = args.includes('--purge');
const daysIndex = args.findIndex((a) => a === '-d' || a === '--days');
const olderThanDays = daysIndex >= 0 ? parseInt(args[daysIndex + 1]!, 10) : 30;
const purgeDaysIndex = args.findIndex((a) => a === '--purge-days');
const purgeAfterDays = purgeDaysIndex >= 0 ? parseInt(args[purgeDaysIndex + 1]!, 10) : 730;

async function main(): Promise<void> {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║              Issue Archival Tool                           ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log();

  try {
    // Show current stats
    const stats = await getArchiveStats();
    console.log('Current Status:');
    console.log(`  Main table:    ${stats.mainTableCount.toLocaleString()} issues`);
    console.log(`  Archive table: ${stats.archiveTableCount.toLocaleString()} issues`);
    if (stats.oldestArchived) {
      console.log(`  Oldest archived: ${stats.oldestArchived.toISOString()}`);
      console.log(`  Newest archived: ${stats.newestArchived?.toISOString()}`);
    }
    console.log();

    if (showStats) {
      return;
    }

    // Calculate cutoff date
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    // Count issues that would be archived
    const [previewCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(issues)
      .where(
        and(
          inArray(issues.status, ['resolved', 'failed']),
          lt(issues.updatedAt, cutoffDate)
        )
      );

    const eligibleCount = previewCount?.count ?? 0;

    console.log(`Archive Settings:`);
    console.log(`  Cutoff:   ${olderThanDays} days (${cutoffDate.toISOString()})`);
    console.log(`  Eligible: ${eligibleCount.toLocaleString()} issues`);
    console.log();

    if (eligibleCount === 0) {
      console.log('✓ No issues to archive');
      return;
    }

    if (dryRun) {
      console.log('DRY RUN: Would archive', eligibleCount, 'issues');
      console.log('Run without --dry-run to perform the archival');
      return;
    }

    // Perform archival
    console.log('Archiving issues...');
    const startTime = Date.now();

    const result = await archiveResolvedIssues(olderThanDays);

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log();
    console.log('Results:');
    console.log(`  Archived: ${result.archivedCount.toLocaleString()} issues`);
    console.log(`  Duration: ${duration}s`);

    if (result.errors.length > 0) {
      console.log(`  Errors:   ${result.errors.length}`);
      result.errors.forEach((e) => console.log(`    - ${e}`));
    }

    // Purge old archives if requested
    if (runPurge) {
      console.log();
      console.log('─'.repeat(60));
      console.log();

      const purgeCutoff = new Date();
      purgeCutoff.setDate(purgeCutoff.getDate() - purgeAfterDays);

      // Count archives that would be purged
      const [purgePreview] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(issuesArchive)
        .where(lt(issuesArchive.archivedAt, purgeCutoff));

      const purgeEligible = purgePreview?.count ?? 0;

      console.log('Purge Settings:');
      console.log(`  Retention:  ${purgeAfterDays} days`);
      console.log(`  Cutoff:     ${purgeCutoff.toISOString()}`);
      console.log(`  Eligible:   ${purgeEligible.toLocaleString()} archived issues`);
      console.log();

      if (purgeEligible > 0 && !dryRun) {
        console.log('Purging old archives...');
        const purgeStart = Date.now();
        const purgeResult = await purgeOldArchives(purgeAfterDays);
        const purgeDuration = ((Date.now() - purgeStart) / 1000).toFixed(2);

        console.log();
        console.log('Purge Results:');
        console.log(`  Purged:   ${purgeResult.purgedCount.toLocaleString()} issues`);
        console.log(`  Duration: ${purgeDuration}s`);

        if (purgeResult.errors.length > 0) {
          console.log(`  Errors:   ${purgeResult.errors.length}`);
          purgeResult.errors.forEach((e) => console.log(`    - ${e}`));
        }
      } else if (dryRun && purgeEligible > 0) {
        console.log(`DRY RUN: Would purge ${purgeEligible} archived issues`);
      } else {
        console.log('✓ No archives to purge');
      }
    }

    // Show updated stats
    const finalStats = await getArchiveStats();
    console.log();
    console.log('Final Status:');
    console.log(`  Main table:    ${finalStats.mainTableCount.toLocaleString()} issues`);
    console.log(`  Archive table: ${finalStats.archiveTableCount.toLocaleString()} issues`);

    console.log();
    console.log('✓ Complete');
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  } finally {
    await closeDatabase();
  }
}

main();
