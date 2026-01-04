// src/services/wearables/tokenManager.ts
// Secure OAuth token management for wearable integrations

import { pool } from '../../db/pool';
import { encrypt, decrypt, FieldContext } from '../encryption';
import type { SourceType, TokenSet, ConnectedSource, ConnectedSourceWithTokens } from './types';

// Token refresh buffer - refresh 5 minutes before expiry
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

// Provider OAuth endpoints
const PROVIDER_CONFIG: Record<string, { tokenUrl: string; authHeader: boolean }> = {
  fitbit: {
    tokenUrl: 'https://api.fitbit.com/oauth2/token',
    authHeader: true, // Uses Basic auth header
  },
  strava: {
    tokenUrl: 'https://www.strava.com/oauth/token',
    authHeader: false, // Uses body params
  },
  oura: {
    tokenUrl: 'https://api.ouraring.com/oauth/token',
    authHeader: false,
  },
  whoop: {
    tokenUrl: 'https://api.whoop.com/oauth/token',
    authHeader: false,
  },
  withings: {
    tokenUrl: 'https://wbsapi.withings.net/v2/oauth2',
    authHeader: false,
  },
  garmin: {
    tokenUrl: '', // Garmin uses OAuth 1.0a - handled separately
    authHeader: false,
  },
};

/**
 * Token Manager
 * Handles secure storage, retrieval, and refresh of OAuth tokens
 */
export class TokenManager {
  /**
   * Store tokens for a connected source
   * Encrypts tokens before storing in database
   */
  async storeTokens(
    customerId: string,
    sourceType: SourceType,
    tokens: TokenSet,
    sourceUserId?: string,
    scopes?: string[]
  ): Promise<void> {
    const accessTokenEncrypted = encrypt(tokens.accessToken, FieldContext.OAUTH_TOKEN);
    const refreshTokenEncrypted = tokens.refreshToken
      ? encrypt(tokens.refreshToken, FieldContext.REFRESH_TOKEN)
      : null;

    await pool.query(
      `INSERT INTO hc_connected_sources (
        customer_id, source_type, access_token_encrypted, refresh_token_encrypted,
        token_expires_at, source_user_id, scopes_granted, connected_at,
        sync_enabled, is_primary_source
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), true, false)
      ON CONFLICT (customer_id, source_type)
      DO UPDATE SET
        access_token_encrypted = $3,
        refresh_token_encrypted = COALESCE($4, hc_connected_sources.refresh_token_encrypted),
        token_expires_at = $5,
        source_user_id = COALESCE($6, hc_connected_sources.source_user_id),
        scopes_granted = COALESCE($7, hc_connected_sources.scopes_granted),
        disconnected_at = NULL,
        updated_at = NOW()`,
      [
        customerId,
        sourceType,
        accessTokenEncrypted,
        refreshTokenEncrypted,
        tokens.expiresAt || null,
        sourceUserId || null,
        scopes || tokens.scopes || [],
      ]
    );
  }

  /**
   * Get a valid access token for a source
   * Automatically refreshes if expired or about to expire
   */
  async getValidToken(customerId: string, sourceType: SourceType): Promise<string> {
    const source = await this.getSourceWithTokens(customerId, sourceType);

    if (!source) {
      throw new Error(`No connected source found for ${sourceType}`);
    }

    // Check if token needs refresh
    if (this.needsRefresh(source.tokenExpiresAt)) {
      if (!source.refreshToken) {
        throw new Error(`Token expired and no refresh token available for ${sourceType}`);
      }

      const newTokens = await this.refreshToken(sourceType, source.refreshToken);
      await this.storeTokens(customerId, sourceType, newTokens);
      return newTokens.accessToken;
    }

    return source.accessToken;
  }

  /**
   * Get connected source with decrypted tokens
   */
  async getSourceWithTokens(
    customerId: string,
    sourceType: SourceType
  ): Promise<ConnectedSourceWithTokens | null> {
    const result = await pool.query(
      `SELECT * FROM hc_connected_sources
       WHERE customer_id = $1 AND source_type = $2 AND disconnected_at IS NULL`,
      [customerId, sourceType]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];

    return {
      id: row.id,
      customerId: row.customer_id,
      sourceType: row.source_type as SourceType,
      sourceUserId: row.source_user_id,
      scopesGranted: row.scopes_granted || [],
      isPrimarySource: row.is_primary_source,
      syncEnabled: row.sync_enabled,
      lastSyncAt: row.last_sync_at,
      lastSyncStatus: row.last_sync_status,
      lastError: row.last_error,
      connectedAt: row.connected_at,
      disconnectedAt: row.disconnected_at,
      tokenExpiresAt: row.token_expires_at,
      accessToken: row.access_token_encrypted
        ? decrypt(row.access_token_encrypted, FieldContext.OAUTH_TOKEN)
        : '',
      refreshToken: row.refresh_token_encrypted
        ? decrypt(row.refresh_token_encrypted, FieldContext.REFRESH_TOKEN)
        : undefined,
    };
  }

  /**
   * Get connected source without tokens (for API responses)
   */
  async getSource(customerId: string, sourceType: SourceType): Promise<ConnectedSource | null> {
    const result = await pool.query(
      `SELECT id, customer_id, source_type, source_user_id, scopes_granted,
              is_primary_source, sync_enabled, last_sync_at, last_sync_status,
              last_error, connected_at, disconnected_at, token_expires_at
       FROM hc_connected_sources
       WHERE customer_id = $1 AND source_type = $2 AND disconnected_at IS NULL`,
      [customerId, sourceType]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return this.mapRowToSource(row);
  }

  /**
   * Get all connected sources for a customer
   */
  async getAllSources(customerId: string): Promise<ConnectedSource[]> {
    const result = await pool.query(
      `SELECT id, customer_id, source_type, source_user_id, scopes_granted,
              is_primary_source, sync_enabled, last_sync_at, last_sync_status,
              last_error, connected_at, disconnected_at, token_expires_at
       FROM hc_connected_sources
       WHERE customer_id = $1 AND disconnected_at IS NULL
       ORDER BY connected_at DESC`,
      [customerId]
    );

    return result.rows.map(row => this.mapRowToSource(row));
  }

  /**
   * Get all sources with tokens expiring soon (for cron job)
   */
  async getSourcesWithExpiringTokens(withinMinutes: number): Promise<ConnectedSource[]> {
    const result = await pool.query(
      `SELECT id, customer_id, source_type, source_user_id, scopes_granted,
              is_primary_source, sync_enabled, last_sync_at, last_sync_status,
              last_error, connected_at, disconnected_at, token_expires_at
       FROM hc_connected_sources
       WHERE disconnected_at IS NULL
         AND sync_enabled = true
         AND token_expires_at IS NOT NULL
         AND token_expires_at <= NOW() + INTERVAL '${withinMinutes} minutes'
       ORDER BY token_expires_at ASC`,
      []
    );

    return result.rows.map(row => this.mapRowToSource(row));
  }

  /**
   * Disconnect a source (soft delete)
   */
  async disconnectSource(customerId: string, sourceType: SourceType): Promise<void> {
    // First, try to revoke the token with the provider
    try {
      const source = await this.getSourceWithTokens(customerId, sourceType);
      if (source?.accessToken) {
        await this.revokeToken(sourceType, source.accessToken);
      }
    } catch (error) {
      console.warn(`Failed to revoke ${sourceType} token:`, error);
      // Continue with disconnect even if revocation fails
    }

    // Soft delete - clear tokens but keep record
    await pool.query(
      `UPDATE hc_connected_sources
       SET disconnected_at = NOW(),
           access_token_encrypted = NULL,
           refresh_token_encrypted = NULL,
           sync_enabled = false,
           updated_at = NOW()
       WHERE customer_id = $1 AND source_type = $2`,
      [customerId, sourceType]
    );
  }

  /**
   * Update source sync status
   */
  async updateSyncStatus(
    customerId: string,
    sourceType: SourceType,
    status: 'success' | 'partial' | 'failed' | 'pending',
    error?: string
  ): Promise<void> {
    await pool.query(
      `UPDATE hc_connected_sources
       SET last_sync_at = NOW(),
           last_sync_status = $3,
           last_error = $4,
           updated_at = NOW()
       WHERE customer_id = $1 AND source_type = $2`,
      [customerId, sourceType, status, error || null]
    );
  }

  /**
   * Update source settings
   */
  async updateSourceSettings(
    customerId: string,
    sourceType: SourceType,
    settings: { isPrimarySource?: boolean; syncEnabled?: boolean }
  ): Promise<void> {
    const updates: string[] = [];
    const values: any[] = [customerId, sourceType];
    let paramIndex = 3;

    if (settings.isPrimarySource !== undefined) {
      // If setting as primary, unset other primary sources first
      if (settings.isPrimarySource) {
        await pool.query(
          `UPDATE hc_connected_sources
           SET is_primary_source = false
           WHERE customer_id = $1 AND is_primary_source = true`,
          [customerId]
        );
      }
      updates.push(`is_primary_source = $${paramIndex}`);
      values.push(settings.isPrimarySource);
      paramIndex++;
    }

    if (settings.syncEnabled !== undefined) {
      updates.push(`sync_enabled = $${paramIndex}`);
      values.push(settings.syncEnabled);
      paramIndex++;
    }

    if (updates.length === 0) return;

    await pool.query(
      `UPDATE hc_connected_sources
       SET ${updates.join(', ')}, updated_at = NOW()
       WHERE customer_id = $1 AND source_type = $2`,
      values
    );
  }

  /**
   * Check if token needs refresh
   */
  needsRefresh(expiresAt?: Date): boolean {
    if (!expiresAt) return false;
    return new Date().getTime() > expiresAt.getTime() - REFRESH_BUFFER_MS;
  }

  /**
   * Refresh OAuth token with provider
   */
  async refreshToken(sourceType: SourceType, refreshToken: string): Promise<TokenSet> {
    const config = PROVIDER_CONFIG[sourceType];

    if (!config || !config.tokenUrl) {
      throw new Error(`Token refresh not supported for ${sourceType}`);
    }

    switch (sourceType) {
      case 'fitbit':
        return this.refreshFitbitToken(refreshToken);
      case 'strava':
        return this.refreshStravaToken(refreshToken);
      case 'oura':
        return this.refreshOuraToken(refreshToken);
      case 'withings':
        return this.refreshWithingsToken(refreshToken);
      // WHOOP disabled - requires paid API access
      // case 'whoop':
      //   return this.refreshWhoopToken(refreshToken);
      default:
        throw new Error(`Token refresh not implemented for ${sourceType}`);
    }
  }

  /**
   * Revoke token with provider (on disconnect)
   */
  private async revokeToken(sourceType: SourceType, accessToken: string): Promise<void> {
    // Provider-specific revocation
    switch (sourceType) {
      case 'fitbit':
        await fetch('https://api.fitbit.com/oauth2/revoke', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Bearer ${accessToken}`,
          },
          body: `token=${accessToken}`,
        });
        break;
      case 'strava':
        await fetch('https://www.strava.com/oauth/deauthorize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `access_token=${accessToken}`,
        });
        break;
      // Other providers may not have revocation endpoints
      default:
        // No-op for providers without revocation
        break;
    }
  }

  // =====================================
  // Provider-specific refresh methods
  // =====================================

  private async refreshFitbitToken(refreshToken: string): Promise<TokenSet> {
    const clientId = process.env.FITBIT_CLIENT_ID;
    const clientSecret = process.env.FITBIT_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error('Fitbit credentials not configured');
    }

    const response = await fetch('https://api.fitbit.com/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Fitbit token refresh failed: ${error}`);
    }

    const data = await response.json();

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token, // Fitbit rotates refresh tokens
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
      scopes: data.scope?.split(' ') || [],
    };
  }

  private async refreshStravaToken(refreshToken: string): Promise<TokenSet> {
    const clientId = process.env.STRAVA_CLIENT_ID;
    const clientSecret = process.env.STRAVA_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error('Strava credentials not configured');
    }

    const response = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Strava token refresh failed: ${error}`);
    }

    const data = await response.json();

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token, // Strava rotates refresh tokens
      expiresAt: new Date(data.expires_at * 1000),
    };
  }

  private async refreshOuraToken(refreshToken: string): Promise<TokenSet> {
    const clientId = process.env.OURA_CLIENT_ID;
    const clientSecret = process.env.OURA_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error('Oura credentials not configured');
    }

    const response = await fetch('https://api.ouraring.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Oura token refresh failed: ${error}`);
    }

    const data = await response.json();

    // Note: Oura refresh tokens are single-use!
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token, // New refresh token (single-use)
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
    };
  }

// WHOOP disabled - requires paid API access
  // private async refreshWhoopToken(refreshToken: string): Promise<TokenSet> {
  //   const clientId = process.env.WHOOP_CLIENT_ID;
  //   const clientSecret = process.env.WHOOP_CLIENT_SECRET;
  //   if (!clientId || !clientSecret) {
  //     throw new Error('WHOOP credentials not configured');
  //   }
  //   const response = await fetch('https://api.whoop.com/oauth/token', {
  //     method: 'POST',
  //     headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  //     body: new URLSearchParams({
  //       client_id: clientId,
  //       client_secret: clientSecret,
  //       grant_type: 'refresh_token',
  //       refresh_token: refreshToken,
  //     }),
  //   });
  //   if (!response.ok) {
  //     const error = await response.text();
  //     throw new Error(`WHOOP token refresh failed: ${error}`);
  //   }
  //   const data = await response.json();
  //   return {
  //     accessToken: data.access_token,
  //     refreshToken: data.refresh_token,
  //     expiresAt: new Date(Date.now() + data.expires_in * 1000),
  //   };
  // }

  private async refreshWithingsToken(refreshToken: string): Promise<TokenSet> {
    const clientId = process.env.WITHINGS_CLIENT_ID;
    const clientSecret = process.env.WITHINGS_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error('Withings credentials not configured');
    }

    const response = await fetch('https://wbsapi.withings.net/v2/oauth2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        action: 'requesttoken',
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Withings token refresh failed: ${error}`);
    }

    const data = await response.json();

    if (data.status !== 0) {
      throw new Error(`Withings API error: ${data.error || 'Unknown error'}`);
    }

    return {
      accessToken: data.body.access_token,
      refreshToken: data.body.refresh_token,
      expiresAt: new Date(Date.now() + data.body.expires_in * 1000),
    };
  }

  // =====================================
  // Helper methods
  // =====================================

  private mapRowToSource(row: any): ConnectedSource {
    return {
      id: row.id,
      customerId: row.customer_id,
      sourceType: row.source_type as SourceType,
      sourceUserId: row.source_user_id,
      scopesGranted: row.scopes_granted || [],
      isPrimarySource: row.is_primary_source,
      syncEnabled: row.sync_enabled,
      lastSyncAt: row.last_sync_at,
      lastSyncStatus: row.last_sync_status,
      lastError: row.last_error,
      connectedAt: row.connected_at,
      disconnectedAt: row.disconnected_at,
      tokenExpiresAt: row.token_expires_at,
    };
  }
}

// Export singleton instance
export const tokenManager = new TokenManager();
