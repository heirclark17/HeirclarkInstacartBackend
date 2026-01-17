import { pool } from '../src/db/pool';
import fs from 'fs';
import path from 'path';

async function runMigrations() {
  console.log('Starting MCP database migrations...\n');

  try {
    // Migration 1: Create MCP audit log table
    console.log('Creating hc_mcp_audit_log table...');
    const auditLogSQL = fs.readFileSync(
      path.join(__dirname, '../migrations/create_mcp_audit_log.sql'),
      'utf8'
    );
    await pool.query(auditLogSQL);
    console.log('✅ hc_mcp_audit_log table created\n');

    // Migration 2: Create health history table
    console.log('Creating hc_health_history table...');
    const healthHistorySQL = fs.readFileSync(
      path.join(__dirname, '../migrations/create_health_history_table.sql'),
      'utf8'
    );
    await pool.query(healthHistorySQL);
    console.log('✅ hc_health_history table created\n');

    console.log('All MCP migrations completed successfully! 🎉');
    process.exit(0);
  } catch (error: any) {
    console.error('Migration failed:', error);
    console.error('Error details:', error.message);
    process.exit(1);
  }
}

runMigrations();
