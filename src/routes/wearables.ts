// src/routes/wearables.ts
// Wearables integration routes - OAuth connections, sync, and data

import { Router } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { pool } from '../db/pool';
import {
  tokenManager,
  PROVIDER_INFO,
  getProviderInfo,
  isValidSourceType,
  isValidDataType,
  SourceType,
  DataType,
} from '../services/wearables';
import { authMiddleware } from '../middleware/auth';

export const wearablesRouter = Router();

// ✅ SECURITY FIX: Apply STRICT authentication (OWASP A01: IDOR Protection)
wearablesRouter.use(authMiddleware());

// ============================================
// Validation Schemas
// ============================================

const sourceTypeSchema = z.enum([
  'apple_health', 'health_connect', 'fitbit', 'garmin',
  'strava', 'oura', 'whoop', 'withings', 'manual'
]);

const dataTypeSchema = z.enum([
  'steps', 'calories', 'distance', 'sleep',
  'weight', 'heart_rate', 'hrv', 'workout'
]);

const updateSourceSettingsSchema = z.object({
  isPrimarySource: z.boolean().optional(),
  syncEnabled: z.boolean().optional(),
});

const setPrioritySchema = z.object({
  order: z.array(sourceTypeSchema).min(1),
});

const oauthCallbackSchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

// OAuth state storage (in production, use Redis with TTL)
const oauthStates = new Map<string, {
  customerId: string;
  sourceType: SourceType;
  redirectUri: string;
  createdAt: Date;
}>();

// Clean up old OAuth states every 10 minutes
setInterval(() => {
  const now = Date.now();
  const maxAge = 10 * 60 * 1000; // 10 minutes
  for (const [state, data] of oauthStates.entries()) {
    if (now - data.createdAt.getTime() > maxAge) {
      oauthStates.delete(state);
    }
  }
}, 10 * 60 * 1000);

// ============================================
// Provider Info
// ============================================

/**
 * GET /api/v1/wearables/providers
 * List all available wearable providers with their capabilities
 */
wearablesRouter.get('/providers', (req, res) => {
  res.json({
    providers: PROVIDER_INFO.map(p => ({
      type: p.type,
      name: p.name,
      icon: p.icon,
      description: p.description,
      dataTypes: p.dataTypes,
      authType: p.authType,
      platform: p.platform,
    })),
  });
});

// ============================================
// Connected Sources CRUD
// ============================================

/**
 * GET /api/v1/wearables/sources
 * List all connected sources for the current user
 */
wearablesRouter.get('/sources', async (req, res, next) => {
  try {
    const customerId = req.headers['x-shopify-customer-id'] as string;
    if (!customerId) {
      return res.status(401).json({ error: 'Missing customer ID' });
    }

    const sources = await tokenManager.getAllSources(customerId);

    // Enrich with provider info
    const enrichedSources = sources.map(source => ({
      ...source,
      provider: getProviderInfo(source.sourceType),
    }));

    res.json({ sources: enrichedSources });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/wearables/sources/:sourceType
 * Get details for a specific connected source
 */
wearablesRouter.get('/sources/:sourceType', async (req, res, next) => {
  try {
    const customerId = req.headers['x-shopify-customer-id'] as string;
    if (!customerId) {
      return res.status(401).json({ error: 'Missing customer ID' });
    }

    const sourceType = req.params.sourceType;
    if (!isValidSourceType(sourceType)) {
      return res.status(400).json({ error: 'Invalid source type' });
    }

    const source = await tokenManager.getSource(customerId, sourceType as SourceType);

    if (!source) {
      return res.status(404).json({ error: 'Source not connected' });
    }

    res.json({
      source: {
        ...source,
        provider: getProviderInfo(source.sourceType),
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/v1/wearables/sources/:sourceType/settings
 * Update source settings (primary source, sync enabled)
 */
wearablesRouter.put('/sources/:sourceType/settings', async (req, res, next) => {
  try {
    const customerId = req.headers['x-shopify-customer-id'] as string;
    if (!customerId) {
      return res.status(401).json({ error: 'Missing customer ID' });
    }

    const sourceType = req.params.sourceType;
    if (!isValidSourceType(sourceType)) {
      return res.status(400).json({ error: 'Invalid source type' });
    }

    const settings = updateSourceSettingsSchema.parse(req.body);

    // Verify source exists
    const source = await tokenManager.getSource(customerId, sourceType as SourceType);
    if (!source) {
      return res.status(404).json({ error: 'Source not connected' });
    }

    await tokenManager.updateSourceSettings(customerId, sourceType as SourceType, settings);

    // Return updated source
    const updatedSource = await tokenManager.getSource(customerId, sourceType as SourceType);

    res.json({
      success: true,
      source: updatedSource,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/v1/wearables/sources/:sourceType
 * Disconnect a source
 */
wearablesRouter.delete('/sources/:sourceType', async (req, res, next) => {
  try {
    const customerId = req.headers['x-shopify-customer-id'] as string;
    if (!customerId) {
      return res.status(401).json({ error: 'Missing customer ID' });
    }

    const sourceType = req.params.sourceType;
    if (!isValidSourceType(sourceType)) {
      return res.status(400).json({ error: 'Invalid source type' });
    }

    await tokenManager.disconnectSource(customerId, sourceType as SourceType);

    res.json({ success: true, message: `${sourceType} disconnected` });
  } catch (err) {
    next(err);
  }
});

// ============================================
// OAuth Flow
// ============================================

// OAuth provider configurations
// Note: WHOOP requires paid API access - excluded for now
const OAUTH_CONFIGS: Record<string, {
  authUrl: string;
  scopes: string[];
  extraParams?: Record<string, string>;
}> = {
  fitbit: {
    authUrl: 'https://www.fitbit.com/oauth2/authorize',
    scopes: ['activity', 'heartrate', 'nutrition', 'sleep', 'weight', 'profile'],
    extraParams: { response_type: 'code', prompt: 'consent' },
  },
  strava: {
    authUrl: 'https://www.strava.com/oauth/authorize',
    scopes: ['read', 'activity:read_all', 'profile:read_all'],
    extraParams: { response_type: 'code', approval_prompt: 'force' },
  },
  oura: {
    authUrl: 'https://cloud.ouraring.com/oauth/authorize',
    scopes: ['daily', 'heartrate', 'workout', 'session', 'personal'],
    extraParams: { response_type: 'code' },
  },
  withings: {
    authUrl: 'https://account.withings.com/oauth2_user/authorize2',
    scopes: ['user.metrics', 'user.activity', 'user.sleepevents'],
    extraParams: { response_type: 'code' },
  },
  // WHOOP - disabled (requires paid API access)
  // whoop: {
  //   authUrl: 'https://api.whoop.com/oauth/authorize',
  //   scopes: ['read:profile', 'read:recovery', 'read:cycles', 'read:sleep', 'read:workout', 'read:body_measurement'],
  //   extraParams: { response_type: 'code' },
  // },
};

/**
 * POST /api/v1/wearables/sources/:sourceType/connect
 * Initiate OAuth connection flow
 */
wearablesRouter.post('/sources/:sourceType/connect', async (req, res, next) => {
  try {
    const customerId = req.headers['x-shopify-customer-id'] as string;
    if (!customerId) {
      return res.status(401).json({ error: 'Missing customer ID' });
    }

    const sourceType = req.params.sourceType as SourceType;
    if (!isValidSourceType(sourceType)) {
      return res.status(400).json({ error: 'Invalid source type' });
    }

    // Native sources don't use OAuth
    if (['apple_health', 'health_connect', 'manual'].includes(sourceType)) {
      return res.status(400).json({
        error: `${sourceType} uses native authentication, not OAuth`,
      });
    }

    const config = OAUTH_CONFIGS[sourceType];
    if (!config) {
      return res.status(400).json({ error: `OAuth not configured for ${sourceType}` });
    }

    // Get client ID from environment
    const envKey = `${sourceType.toUpperCase()}_CLIENT_ID`;
    const clientId = process.env[envKey];
    if (!clientId) {
      return res.status(500).json({ error: `${sourceType} integration not configured` });
    }

    // Generate state for CSRF protection
    const state = crypto.randomBytes(32).toString('hex');
    const redirectUri = req.body.redirectUri || `${process.env.API_BASE_URL}/api/v1/wearables/callback/${sourceType}`;

    // Store state
    oauthStates.set(state, {
      customerId,
      sourceType,
      redirectUri,
      createdAt: new Date(),
    });

    // Build auth URL
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: config.scopes.join(' '),
      state,
      ...config.extraParams,
    });

    const authUrl = `${config.authUrl}?${params.toString()}`;

    res.json({
      authUrl,
      state,
      redirectUri,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/wearables/callback/:sourceType
 * OAuth callback handler (browser redirect)
 */
wearablesRouter.get('/callback/:sourceType', async (req, res, next) => {
  try {
    const sourceType = req.params.sourceType as SourceType;
    const { code, state, error } = req.query;

    // Handle OAuth errors
    if (error) {
      return res.redirect(`/pages/settings?wearable_error=${error}`);
    }

    if (!code || !state) {
      return res.redirect('/pages/settings?wearable_error=missing_params');
    }

    // Verify state
    const stateData = oauthStates.get(state as string);
    if (!stateData) {
      return res.redirect('/pages/settings?wearable_error=invalid_state');
    }

    // Clear used state
    oauthStates.delete(state as string);

    // Exchange code for token
    try {
      const tokens = await exchangeCodeForTokens(sourceType, code as string, stateData.redirectUri);

      // Get user profile from provider
      let sourceUserId: string | undefined;
      try {
        const profile = await getProviderUserProfile(sourceType, tokens.accessToken);
        sourceUserId = profile.id;
      } catch (e) {
        console.warn(`Failed to get ${sourceType} profile:`, e);
      }

      // Store tokens
      await tokenManager.storeTokens(
        stateData.customerId,
        sourceType,
        tokens,
        sourceUserId,
        tokens.scopes
      );

      // Redirect with success
      res.redirect(`/pages/settings?wearable_connected=${sourceType}`);
    } catch (err: any) {
      console.error(`OAuth token exchange failed for ${sourceType}:`, err);
      res.redirect(`/pages/settings?wearable_error=token_exchange_failed`);
    }
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/wearables/callback/:sourceType
 * OAuth callback handler (API - for mobile apps)
 */
wearablesRouter.post('/callback/:sourceType', async (req, res, next) => {
  try {
    const customerId = req.headers['x-shopify-customer-id'] as string;
    if (!customerId) {
      return res.status(401).json({ error: 'Missing customer ID' });
    }

    const sourceType = req.params.sourceType as SourceType;
    const { code, state } = oauthCallbackSchema.parse(req.body);

    // Verify state
    const stateData = oauthStates.get(state);
    if (!stateData) {
      return res.status(400).json({ error: 'Invalid or expired state' });
    }

    // Verify customer matches
    if (stateData.customerId !== customerId) {
      return res.status(403).json({ error: 'State does not match customer' });
    }

    // Clear used state
    oauthStates.delete(state);

    // Exchange code for token
    const tokens = await exchangeCodeForTokens(sourceType, code, stateData.redirectUri);

    // Get user profile from provider
    let sourceUserId: string | undefined;
    try {
      const profile = await getProviderUserProfile(sourceType, tokens.accessToken);
      sourceUserId = profile.id;
    } catch (e) {
      console.warn(`Failed to get ${sourceType} profile:`, e);
    }

    // Store tokens
    await tokenManager.storeTokens(
      customerId,
      sourceType,
      tokens,
      sourceUserId,
      tokens.scopes
    );

    // Return success with source details
    const source = await tokenManager.getSource(customerId, sourceType);

    res.json({
      success: true,
      source: {
        ...source,
        provider: getProviderInfo(sourceType),
      },
    });
  } catch (err) {
    next(err);
  }
});

// ============================================
// Data Priority Configuration
// ============================================

/**
 * GET /api/v1/wearables/priority
 * Get data type priorities for the current user
 */
wearablesRouter.get('/priority', async (req, res, next) => {
  try {
    const customerId = req.headers['x-shopify-customer-id'] as string;
    if (!customerId) {
      return res.status(401).json({ error: 'Missing customer ID' });
    }

    const result = await pool.query(
      `SELECT data_type, priority_order FROM hc_source_priority WHERE customer_id = $1`,
      [customerId]
    );

    const priorities: Record<string, SourceType[]> = {};
    for (const row of result.rows) {
      priorities[row.data_type] = row.priority_order;
    }

    res.json({ priorities });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/v1/wearables/priority/:dataType
 * Set priority order for a data type
 */
wearablesRouter.put('/priority/:dataType', async (req, res, next) => {
  try {
    const customerId = req.headers['x-shopify-customer-id'] as string;
    if (!customerId) {
      return res.status(401).json({ error: 'Missing customer ID' });
    }

    const dataType = req.params.dataType;
    if (!isValidDataType(dataType)) {
      return res.status(400).json({ error: 'Invalid data type' });
    }

    const { order } = setPrioritySchema.parse(req.body);

    await pool.query(
      `INSERT INTO hc_source_priority (customer_id, data_type, priority_order)
       VALUES ($1, $2, $3)
       ON CONFLICT (customer_id, data_type)
       DO UPDATE SET priority_order = $3, updated_at = NOW()`,
      [customerId, dataType, order]
    );

    res.json({
      success: true,
      dataType,
      priorityOrder: order,
    });
  } catch (err) {
    next(err);
  }
});

// ============================================
// Sync Operations
// ============================================

/**
 * POST /api/v1/wearables/sync
 * Trigger a manual sync for one or all sources
 */
wearablesRouter.post('/sync', async (req, res, next) => {
  try {
    const customerId = req.headers['x-shopify-customer-id'] as string;
    if (!customerId) {
      return res.status(401).json({ error: 'Missing customer ID' });
    }

    const { sourceType, dataTypes, dateRange } = req.body;

    // Validate sourceType if provided
    if (sourceType && !isValidSourceType(sourceType)) {
      return res.status(400).json({ error: 'Invalid source type' });
    }

    // Validate dataTypes if provided
    if (dataTypes) {
      for (const dt of dataTypes) {
        if (!isValidDataType(dt)) {
          return res.status(400).json({ error: `Invalid data type: ${dt}` });
        }
      }
    }

    // Create sync log entry
    const syncId = crypto.randomUUID();
    const sources = sourceType
      ? [sourceType]
      : (await tokenManager.getAllSources(customerId)).map(s => s.sourceType);

    // Start sync in background (placeholder - full implementation in syncOrchestrator)
    for (const st of sources) {
      await pool.query(
        `INSERT INTO hc_sync_log (id, customer_id, source_type, sync_started_at, sync_type, status)
         VALUES ($1, $2, $3, NOW(), 'manual', 'running')`,
        [crypto.randomUUID(), customerId, st]
      );

      // Update last sync status to pending
      await tokenManager.updateSyncStatus(customerId, st as SourceType, 'pending');
    }

    // TODO: Actually trigger sync via syncOrchestrator

    res.json({
      syncId,
      status: 'started',
      sources,
      message: 'Sync initiated. This may take a few minutes.',
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/wearables/sync/status
 * Get recent sync status for all sources
 */
wearablesRouter.get('/sync/status', async (req, res, next) => {
  try {
    const customerId = req.headers['x-shopify-customer-id'] as string;
    if (!customerId) {
      return res.status(401).json({ error: 'Missing customer ID' });
    }

    const result = await pool.query(
      `SELECT DISTINCT ON (source_type)
         id, source_type, sync_started_at, sync_completed_at, sync_type, status,
         records_fetched, records_inserted, records_updated, records_deduped,
         error_message
       FROM hc_sync_log
       WHERE customer_id = $1
       ORDER BY source_type, sync_started_at DESC`,
      [customerId]
    );

    const syncStatus = result.rows.map(row => ({
      sourceType: row.source_type,
      lastSyncAt: row.sync_started_at,
      completedAt: row.sync_completed_at,
      syncType: row.sync_type,
      status: row.status,
      records: {
        fetched: row.records_fetched,
        inserted: row.records_inserted,
        updated: row.records_updated,
        deduped: row.records_deduped,
      },
      error: row.error_message,
    }));

    res.json({ syncStatus });
  } catch (err) {
    next(err);
  }
});

// ============================================
// Native Health Store Registration
// ============================================

/**
 * POST /api/v1/wearables/sources/apple_health/register
 * Register Apple Health connection (native app sends this after HealthKit auth)
 */
wearablesRouter.post('/sources/apple_health/register', async (req, res, next) => {
  try {
    const customerId = req.headers['x-shopify-customer-id'] as string;
    if (!customerId) {
      return res.status(401).json({ error: 'Missing customer ID' });
    }

    const { permissions } = req.body;

    // For native health stores, we don't have OAuth tokens
    // Just create the connection record with permissions
    await pool.query(
      `INSERT INTO hc_connected_sources (
        customer_id, source_type, scopes_granted, connected_at, sync_enabled
      ) VALUES ($1, 'apple_health', $2, NOW(), true)
      ON CONFLICT (customer_id, source_type)
      DO UPDATE SET scopes_granted = $2, disconnected_at = NULL, updated_at = NOW()`,
      [customerId, permissions || []]
    );

    const source = await tokenManager.getSource(customerId, 'apple_health');

    res.json({
      success: true,
      source: {
        ...source,
        provider: getProviderInfo('apple_health'),
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/wearables/sources/health_connect/register
 * Register Health Connect connection (native app sends this after permission grant)
 */
wearablesRouter.post('/sources/health_connect/register', async (req, res, next) => {
  try {
    const customerId = req.headers['x-shopify-customer-id'] as string;
    if (!customerId) {
      return res.status(401).json({ error: 'Missing customer ID' });
    }

    const { permissions } = req.body;

    await pool.query(
      `INSERT INTO hc_connected_sources (
        customer_id, source_type, scopes_granted, connected_at, sync_enabled
      ) VALUES ($1, 'health_connect', $2, NOW(), true)
      ON CONFLICT (customer_id, source_type)
      DO UPDATE SET scopes_granted = $2, disconnected_at = NULL, updated_at = NOW()`,
      [customerId, permissions || []]
    );

    const source = await tokenManager.getSource(customerId, 'health_connect');

    res.json({
      success: true,
      source: {
        ...source,
        provider: getProviderInfo('health_connect'),
      },
    });
  } catch (err) {
    next(err);
  }
});

// ============================================
// Helper Functions
// ============================================

/**
 * Exchange OAuth authorization code for tokens
 */
async function exchangeCodeForTokens(
  sourceType: SourceType,
  code: string,
  redirectUri: string
): Promise<{ accessToken: string; refreshToken?: string; expiresAt?: Date; scopes?: string[] }> {
  const clientId = process.env[`${sourceType.toUpperCase()}_CLIENT_ID`];
  const clientSecret = process.env[`${sourceType.toUpperCase()}_CLIENT_SECRET`];

  if (!clientId || !clientSecret) {
    throw new Error(`${sourceType} credentials not configured`);
  }

  let tokenUrl: string;
  let headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
  let body: URLSearchParams;

  switch (sourceType) {
    case 'fitbit':
      tokenUrl = 'https://api.fitbit.com/oauth2/token';
      headers['Authorization'] = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
      body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      });
      break;

    case 'strava':
      tokenUrl = 'https://www.strava.com/oauth/token';
      body = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code,
      });
      break;

    case 'oura':
      tokenUrl = 'https://api.ouraring.com/oauth/token';
      body = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      });
      break;

    // WHOOP disabled - requires paid API access
    // case 'whoop':
    //   tokenUrl = 'https://api.whoop.com/oauth/token';
    //   body = new URLSearchParams({
    //     client_id: clientId,
    //     client_secret: clientSecret,
    //     grant_type: 'authorization_code',
    //     code,
    //     redirect_uri: redirectUri,
    //   });
    //   break;

    case 'withings':
      tokenUrl = 'https://wbsapi.withings.net/v2/oauth2';
      body = new URLSearchParams({
        action: 'requesttoken',
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      });
      break;

    default:
      throw new Error(`Token exchange not implemented for ${sourceType}`);
  }

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers,
    body,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token exchange failed: ${error}`);
  }

  const data = await response.json();

  // Handle Withings response format
  if (sourceType === 'withings') {
    if (data.status !== 0) {
      throw new Error(`Withings error: ${data.error || 'Unknown'}`);
    }
    return {
      accessToken: data.body.access_token,
      refreshToken: data.body.refresh_token,
      expiresAt: new Date(Date.now() + data.body.expires_in * 1000),
      scopes: data.body.scope?.split(',') || [],
    };
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000)
      : data.expires_at
        ? new Date(data.expires_at * 1000)
        : undefined,
    scopes: data.scope?.split(' ') || data.scope?.split(',') || [],
  };
}

/**
 * Get user profile from provider
 */
async function getProviderUserProfile(
  sourceType: SourceType,
  accessToken: string
): Promise<{ id: string; email?: string; name?: string }> {
  let url: string;
  let headers: Record<string, string> = { Authorization: `Bearer ${accessToken}` };

  switch (sourceType) {
    case 'fitbit':
      url = 'https://api.fitbit.com/1/user/-/profile.json';
      break;
    case 'strava':
      url = 'https://www.strava.com/api/v3/athlete';
      break;
    case 'oura':
      url = 'https://api.ouraring.com/v2/usercollection/personal_info';
      break;
    // WHOOP disabled - requires paid API access
    // case 'whoop':
    //   url = 'https://api.whoop.com/developer/v1/user/profile/basic';
    //   break;
    case 'withings':
      // Withings doesn't have a simple profile endpoint
      return { id: 'withings-user' };
    default:
      throw new Error(`Profile fetch not implemented for ${sourceType}`);
  }

  const response = await fetch(url, { headers });

  if (!response.ok) {
    throw new Error(`Profile fetch failed: ${response.status}`);
  }

  const data = await response.json();

  switch (sourceType) {
    case 'fitbit':
      return {
        id: data.user.encodedId,
        name: data.user.fullName,
      };
    case 'strava':
      return {
        id: data.id.toString(),
        email: data.email,
        name: `${data.firstname} ${data.lastname}`,
      };
    case 'oura':
      return {
        id: data.id,
        email: data.email,
      };
    // WHOOP disabled - requires paid API access
    // case 'whoop':
    //   return {
    //     id: data.user_id?.toString(),
    //     email: data.email,
    //     name: `${data.first_name} ${data.last_name}`,
    //   };
    default:
      return { id: 'unknown' };
  }
}
