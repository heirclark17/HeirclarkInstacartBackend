import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import agentConfig from '../../config/agentConfig.json';
import toolMappings from '../../config/mcpTools.json';
import { Pool } from 'pg';

interface MCPServerConfig {
  command: string;
  args: string[];
  env: Record<string, string>;
  transport: string;
  timeout: number;
  retryAttempts?: number;
  dataTypes?: string[];
  rateLimit?: {
    requestsPerHour: number;
    burstSize: number;
  };
}

interface SyncResult {
  success: boolean;
  recordsFetched: number;
  recordsInserted: number;
  errors?: string[];
}

interface DateRange {
  start: string;
  end: string;
}

class MCPOrchestrator {
  private clients: Map<string, Client> = new Map();
  private rateLimiters: Map<string, { count: number; resetAt: number }> = new Map();
  private db: Pool;

  constructor(db: Pool) {
    this.db = db;
  }

  /**
   * Connect to an MCP server via stdio transport
   */
  async connectToMCP(provider: string): Promise<Client> {
    if (this.clients.has(provider)) {
      console.log(`[MCP Orchestrator] Reusing existing connection for ${provider}`);
      return this.clients.get(provider)!;
    }

    const serverConfig = (agentConfig.mcpServers as Record<string, MCPServerConfig>)[provider];
    if (!serverConfig) {
      throw new Error(`MCP server not configured: ${provider}`);
    }

    console.log(`[MCP Orchestrator] Connecting to MCP server: ${provider}`);
    console.log(`[MCP Orchestrator] Command: ${serverConfig.command} ${serverConfig.args.join(' ')}`);

    const transport = new StdioClientTransport({
      command: serverConfig.command,
      args: serverConfig.args,
      env: this.resolveEnvVars(serverConfig.env),
    });

    const client = new Client(
      {
        name: `heirclark-backend-${provider}`,
        version: '1.0.0',
      },
      { capabilities: {} }
    );

    try {
      await client.connect(transport);
      console.log(`[MCP Orchestrator] Successfully connected to ${provider}`);

      this.clients.set(provider, client);

      return client;
    } catch (error) {
      console.error(`[MCP Orchestrator] Failed to connect to ${provider}:`, error);
      throw error;
    }
  }

  /**
   * Sync data from a specific provider
   */
  async syncProvider(
    provider: string,
    customerId: string,
    dateRange?: DateRange
  ): Promise<SyncResult> {
    console.log(`[MCP Orchestrator] Starting sync for ${provider}, customer ${customerId}`);

    try {
      // Check rate limit
      if (!this.checkRateLimit(provider)) {
        throw new Error(`Rate limit exceeded for provider: ${provider}`);
      }

      // Connect to MCP
      const client = await this.connectToMCP(provider);

      // Get provider-specific data
      const rawData = await this.fetchProviderData(client, provider, dateRange);

      // Normalize data
      const normalizedData = await this.normalizeData(provider, rawData, customerId);

      // Store in database
      const inserted = await this.storeData(provider, normalizedData);

      // Log audit trail
      await this.logAudit(provider, customerId, 'sync', true, normalizedData.length);

      return {
        success: true,
        recordsFetched: normalizedData.length,
        recordsInserted: inserted,
      };
    } catch (error: any) {
      console.error(`[MCP Orchestrator] Sync failed for ${provider}:`, error);
      await this.logAudit(provider, customerId, 'sync', false, 0, error.message);

      return {
        success: false,
        recordsFetched: 0,
        recordsInserted: 0,
        errors: [error.message],
      };
    }
  }

  /**
   * Fetch data from provider using appropriate tool
   */
  private async fetchProviderData(
    client: Client,
    provider: string,
    dateRange?: DateRange
  ): Promise<any> {
    const today = new Date().toISOString().split('T')[0];
    const startDate = dateRange?.start || today;
    const endDate = dateRange?.end || today;

    console.log(`[MCP Orchestrator] Fetching data from ${provider} for ${startDate} to ${endDate}`);

    let toolName: string;
    let args: any;

    switch (provider) {
      case 'fitbit':
        toolName = 'get_activity_summary';
        args = { date: startDate };
        break;

      case 'google-fit':
        toolName = 'get_daily_activity';
        args = { startDate, endDate };
        break;

      case 'apple-health':
        // Apple Health uses SQL query interface
        toolName = 'query_health_data';
        args = {
          query: `SELECT * FROM health_data WHERE date BETWEEN '${startDate}' AND '${endDate}'`,
        };
        break;

      default:
        throw new Error(`Unknown provider: ${provider}`);
    }

    const result = await client.callTool({
      name: toolName,
      arguments: args,
    });

    console.log(`[MCP Orchestrator] Received data from ${provider}`);
    return result.content;
  }

  /**
   * Normalize data using provider-specific logic
   */
  private async normalizeData(
    provider: string,
    rawData: any,
    customerId: string
  ): Promise<any[]> {
    console.log(`[MCP Orchestrator] Normalizing data for ${provider}`);

    // Import provider-specific normalizer
    switch (provider) {
      case 'fitbit':
        const { normalizeFitbitData } = await import('./normalizers/fitbitNormalizer');
        return normalizeFitbitData(rawData, customerId);

      case 'google-fit':
        const { normalizeGoogleFitData } = await import('./normalizers/googleFitNormalizer');
        return normalizeGoogleFitData(rawData, customerId);

      case 'apple-health':
        const { normalizeAppleHealthData } = await import('./normalizers/appleHealthNormalizer');
        return normalizeAppleHealthData(rawData, customerId);

      default:
        throw new Error(`No normalizer for provider: ${provider}`);
    }
  }

  /**
   * Store normalized data in database
   */
  private async storeData(provider: string, data: any[]): Promise<number> {
    if (data.length === 0) {
      return 0;
    }

    console.log(`[MCP Orchestrator] Storing ${data.length} records from ${provider}`);

    let inserted = 0;

    for (const record of data) {
      try {
        await this.db.query(
          `INSERT INTO hc_health_history
           (customer_id, source_type, recorded_date, steps, active_calories, resting_calories,
            distance_meters, floors_climbed, active_minutes, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
           ON CONFLICT (customer_id, source_type, recorded_date)
           DO UPDATE SET
             steps = EXCLUDED.steps,
             active_calories = EXCLUDED.active_calories,
             resting_calories = EXCLUDED.resting_calories,
             distance_meters = EXCLUDED.distance_meters,
             floors_climbed = EXCLUDED.floors_climbed,
             active_minutes = EXCLUDED.active_minutes,
             updated_at = NOW()`,
          [
            record.customer_id,
            record.source_type,
            record.recorded_date,
            record.steps,
            record.active_calories,
            record.resting_calories,
            record.distance_meters,
            record.floors_climbed,
            record.active_minutes,
          ]
        );
        inserted++;
      } catch (error: any) {
        console.error(`[MCP Orchestrator] Failed to insert record:`, error.message);
      }
    }

    console.log(`[MCP Orchestrator] Inserted ${inserted} records successfully`);
    return inserted;
  }

  /**
   * Log audit trail
   */
  private async logAudit(
    provider: string,
    customerId: string,
    operation: string,
    success: boolean,
    recordCount: number,
    errorMessage?: string
  ): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO hc_mcp_audit_log
         (customer_id, provider, operation, success, record_count, error_message, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [customerId, provider, operation, success, recordCount, errorMessage || null]
      );
    } catch (error: any) {
      console.error(`[MCP Orchestrator] Failed to log audit:`, error.message);
    }
  }

  /**
   * Check rate limit for provider
   */
  private checkRateLimit(provider: string): boolean {
    const serverConfig = (agentConfig.mcpServers as Record<string, MCPServerConfig>)[provider];
    if (!serverConfig?.rateLimit) {
      return true; // No rate limit configured
    }

    const key = provider;
    const limit = serverConfig.rateLimit.requestsPerHour;
    const window = 3600 * 1000; // 1 hour in ms
    const now = Date.now();

    const current = this.rateLimiters.get(key);

    if (!current || now > current.resetAt) {
      this.rateLimiters.set(key, { count: 1, resetAt: now + window });
      return true;
    }

    if (current.count >= limit) {
      console.warn(`[MCP Orchestrator] Rate limit exceeded for ${provider}`);
      return false;
    }

    current.count++;
    return true;
  }

  /**
   * Resolve environment variables from config
   */
  private resolveEnvVars(env: Record<string, string>): Record<string, string> {
    const resolved: Record<string, string> = {};
    for (const [key, value] of Object.entries(env)) {
      if (value.startsWith('${') && value.endsWith('}')) {
        const envVarName = value.slice(2, -1);
        const envValue = process.env[envVarName];
        if (envValue !== undefined) {
          resolved[key] = envValue;
        }
      } else {
        resolved[key] = value;
      }
    }
    return resolved;
  }

  /**
   * Disconnect from MCP server
   */
  async disconnect(provider: string): Promise<void> {
    console.log(`[MCP Orchestrator] Disconnecting from ${provider}`);

    const client = this.clients.get(provider);
    if (client) {
      try {
        await client.close();
      } catch (error) {
        console.error(`[MCP Orchestrator] Error closing client:`, error);
      }
      this.clients.delete(provider);
    }
  }

  /**
   * Disconnect all MCP servers
   */
  async disconnectAll(): Promise<void> {
    console.log(`[MCP Orchestrator] Disconnecting all MCP servers`);

    const providers = Array.from(this.clients.keys());
    for (const provider of providers) {
      await this.disconnect(provider);
    }
  }
}

export default MCPOrchestrator;
