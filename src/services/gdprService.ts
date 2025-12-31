// src/services/gdprService.ts
// GDPR Data Subject Rights implementation
// GDPR Articles: Art. 17 Right to Erasure, Art. 20 Data Portability

import { pool } from '../db/pool';
import { auditLogger, AuditAction, ResourceType, generateCorrelationId } from './auditLogger';
import { decrypt, FieldContext, isEncrypted } from './encryption';

/**
 * User data export structure (GDPR Article 20)
 */
export interface UserDataExport {
  exportedAt: string;
  userId: string;
  dataCategories: {
    profile: {
      preferences: any;
      createdAt: string;
    } | null;
    healthData: {
      latestMetrics: any;
      dailyHistory: any[];
    };
    nutrition: {
      meals: any[];
      totalMeals: number;
    };
    weight: {
      logs: any[];
      totalLogs: number;
    };
    hydration: {
      logs: any[];
      totalLogs: number;
    };
    videos: {
      generated: any[];
      totalVideos: number;
    };
    devices: {
      linked: any[];
      totalDevices: number;
    };
    wearables: {
      connected: any[];
    };
  };
  auditTrail: {
    recentActivity: any[];
    note: string;
  };
}

/**
 * Deletion result structure
 */
export interface DeletionResult {
  userId: string;
  deletedAt: string;
  deletedCategories: {
    category: string;
    count: number;
  }[];
  anonymizedAuditLogs: number;
  externalServicesNotified: string[];
}

/**
 * Export all user data (GDPR Article 20 - Right to Data Portability)
 * Returns all data associated with a user in a portable JSON format
 */
export async function exportUserData(userId: string, ipAddress: string): Promise<UserDataExport> {
  const correlationId = generateCorrelationId();

  // Log the export request
  await auditLogger.logGdpr(correlationId, userId, AuditAction.GDPR_EXPORT, ipAddress, {
    action: 'data_export_started',
  });

  const exportData: UserDataExport = {
    exportedAt: new Date().toISOString(),
    userId,
    dataCategories: {
      profile: null,
      healthData: { latestMetrics: null, dailyHistory: [] },
      nutrition: { meals: [], totalMeals: 0 },
      weight: { logs: [], totalLogs: 0 },
      hydration: { logs: [], totalLogs: 0 },
      videos: { generated: [], totalVideos: 0 },
      devices: { linked: [], totalDevices: 0 },
      wearables: { connected: [] },
    },
    auditTrail: {
      recentActivity: [],
      note: 'Audit logs are retained for 7 years per SOC2 compliance requirements.',
    },
  };

  // 1. User Preferences
  const prefsResult = await pool.query(`
    SELECT goal_weight_lbs, hydration_target_ml, calories_target,
           protein_target, carbs_target, fat_target, timezone,
           pii_enc, created_at, updated_at
    FROM hc_user_preferences
    WHERE shopify_customer_id = $1
  `, [userId]);

  if (prefsResult.rows.length > 0) {
    const prefs = prefsResult.rows[0];
    // Try to decrypt PII if encrypted
    let piiData = null;
    if (prefs.pii_enc && isEncrypted(prefs.pii_enc)) {
      try {
        piiData = JSON.parse(decrypt(prefs.pii_enc, FieldContext.PII));
      } catch {
        piiData = { note: 'Encrypted data - decryption available on request' };
      }
    }

    exportData.dataCategories.profile = {
      preferences: {
        goalWeight: piiData?.goalWeight ?? prefs.goal_weight_lbs,
        hydrationTarget: piiData?.hydrationTarget ?? prefs.hydration_target_ml,
        caloriesTarget: piiData?.caloriesTarget ?? prefs.calories_target,
        proteinTarget: piiData?.proteinTarget ?? prefs.protein_target,
        carbsTarget: piiData?.carbsTarget ?? prefs.carbs_target,
        fatTarget: piiData?.fatTarget ?? prefs.fat_target,
        timezone: prefs.timezone,
      },
      createdAt: prefs.created_at,
    };
  }

  // 2. Health Metrics (Latest)
  const healthResult = await pool.query(`
    SELECT ts, steps, active_calories, resting_energy, latest_heart_rate_bpm,
           workouts_today, source, metrics_enc, received_at
    FROM hc_health_latest
    WHERE shopify_customer_id = $1
  `, [userId]);

  if (healthResult.rows.length > 0) {
    const health = healthResult.rows[0];
    let metricsData = null;
    if (health.metrics_enc && isEncrypted(health.metrics_enc)) {
      try {
        metricsData = JSON.parse(decrypt(health.metrics_enc, FieldContext.HEALTH_METRICS));
      } catch {
        metricsData = null;
      }
    }

    exportData.dataCategories.healthData.latestMetrics = {
      timestamp: health.ts,
      steps: metricsData?.steps ?? health.steps,
      activeCalories: metricsData?.activeCalories ?? health.active_calories,
      restingEnergy: metricsData?.restingEnergy ?? health.resting_energy,
      heartRate: metricsData?.heartRate ?? health.latest_heart_rate_bpm,
      workouts: metricsData?.workouts ?? health.workouts_today,
      source: health.source,
      receivedAt: health.received_at,
    };
  }

  // 3. Apple Health Daily History
  const dailyResult = await pool.query(`
    SELECT date, burned_kcal, consumed_kcal, last_updated_at
    FROM hc_apple_health_daily
    WHERE shopify_customer_id = $1
    ORDER BY date DESC
  `, [userId]);

  exportData.dataCategories.healthData.dailyHistory = dailyResult.rows.map(row => ({
    date: row.date,
    burnedKcal: parseFloat(row.burned_kcal),
    consumedKcal: parseFloat(row.consumed_kcal),
    updatedAt: row.last_updated_at,
  }));

  // 4. Meals
  const mealsResult = await pool.query(`
    SELECT id, datetime, label, items, items_enc, total_calories,
           total_protein, total_carbs, total_fat, source, created_at
    FROM hc_meals
    WHERE shopify_customer_id = $1
    ORDER BY datetime DESC
  `, [userId]);

  exportData.dataCategories.nutrition.meals = mealsResult.rows.map(row => {
    let items = row.items;
    if (row.items_enc && isEncrypted(row.items_enc)) {
      try {
        items = JSON.parse(decrypt(row.items_enc, FieldContext.NUTRITION_DATA));
      } catch {
        items = row.items;
      }
    }

    return {
      id: row.id,
      datetime: row.datetime,
      label: row.label,
      items,
      totals: {
        calories: row.total_calories,
        protein: row.total_protein,
        carbs: row.total_carbs,
        fat: row.total_fat,
      },
      source: row.source,
      createdAt: row.created_at,
    };
  });
  exportData.dataCategories.nutrition.totalMeals = mealsResult.rows.length;

  // 5. Weight Logs
  const weightResult = await pool.query(`
    SELECT id, date, weight_lbs, weight_enc, created_at
    FROM hc_weight_logs
    WHERE shopify_customer_id = $1
    ORDER BY date DESC
  `, [userId]);

  exportData.dataCategories.weight.logs = weightResult.rows.map(row => {
    let weight = row.weight_lbs;
    if (row.weight_enc && isEncrypted(row.weight_enc)) {
      try {
        weight = parseFloat(decrypt(row.weight_enc, FieldContext.WEIGHT_DATA));
      } catch {
        weight = row.weight_lbs;
      }
    }

    return {
      id: row.id,
      date: row.date,
      weightLbs: parseFloat(weight),
      createdAt: row.created_at,
    };
  });
  exportData.dataCategories.weight.totalLogs = weightResult.rows.length;

  // 6. Hydration Logs
  const waterResult = await pool.query(`
    SELECT id, datetime, amount_ml, created_at
    FROM hc_water_logs
    WHERE shopify_customer_id = $1
    ORDER BY datetime DESC
  `, [userId]);

  exportData.dataCategories.hydration.logs = waterResult.rows.map(row => ({
    id: row.id,
    datetime: row.datetime,
    amountMl: row.amount_ml,
    createdAt: row.created_at,
  }));
  exportData.dataCategories.hydration.totalLogs = waterResult.rows.length;

  // 7. Generated Videos
  const videosResult = await pool.query(`
    SELECT id, heygen_video_id, video_url, status, created_at, expires_at
    FROM hc_user_videos
    WHERE user_id = $1
    ORDER BY created_at DESC
  `, [userId]);

  exportData.dataCategories.videos.generated = videosResult.rows.map(row => ({
    id: row.id,
    videoId: row.heygen_video_id,
    videoUrl: row.video_url,
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  }));
  exportData.dataCategories.videos.totalVideos = videosResult.rows.length;

  // 8. Linked Devices
  const devicesResult = await pool.query(`
    SELECT id, device_key, device_name, created_at, last_seen_at
    FROM hc_health_devices
    WHERE shopify_customer_id = $1
  `, [userId]);

  exportData.dataCategories.devices.linked = devicesResult.rows.map(row => ({
    id: row.id,
    deviceKey: row.device_key.substring(0, 8) + '...', // Partial for privacy
    deviceName: row.device_name,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  }));
  exportData.dataCategories.devices.totalDevices = devicesResult.rows.length;

  // 9. Connected Wearables
  const wearablesResult = await pool.query(`
    SELECT provider, token_type, scope, expires_at, created_at, updated_at
    FROM wearable_tokens
    WHERE customer_id = $1
  `, [userId]);

  exportData.dataCategories.wearables.connected = wearablesResult.rows.map(row => ({
    provider: row.provider,
    scope: row.scope,
    expiresAt: row.expires_at,
    connectedAt: row.created_at,
    updatedAt: row.updated_at,
  }));

  // 10. Recent Audit Activity (last 30 days)
  const auditResult = await pool.query(`
    SELECT timestamp, action, resource_type, request_method, request_path
    FROM audit_logs
    WHERE user_id = $1
    AND timestamp > NOW() - INTERVAL '30 days'
    ORDER BY timestamp DESC
    LIMIT 100
  `, [userId]);

  exportData.auditTrail.recentActivity = auditResult.rows.map(row => ({
    timestamp: row.timestamp,
    action: row.action,
    resourceType: row.resource_type,
    method: row.request_method,
    path: row.request_path,
  }));

  // Log completion
  await auditLogger.logGdpr(correlationId, userId, AuditAction.GDPR_EXPORT, ipAddress, {
    action: 'data_export_completed',
    categoriesExported: Object.keys(exportData.dataCategories).length,
  });

  return exportData;
}

/**
 * Delete all user data (GDPR Article 17 - Right to Erasure)
 * Permanently removes all user data and anonymizes audit logs
 */
export async function deleteUserData(userId: string, ipAddress: string): Promise<DeletionResult> {
  const correlationId = generateCorrelationId();
  const deletedAt = new Date().toISOString();

  // Log deletion request
  await auditLogger.logGdpr(correlationId, userId, AuditAction.GDPR_DELETE, ipAddress, {
    action: 'deletion_started',
  });

  const deletedCategories: { category: string; count: number }[] = [];

  // Use transaction for atomic deletion
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Delete meals
    const mealsDelete = await client.query(
      `DELETE FROM hc_meals WHERE shopify_customer_id = $1`,
      [userId]
    );
    deletedCategories.push({ category: 'meals', count: mealsDelete.rowCount || 0 });

    // 2. Delete water logs
    const waterDelete = await client.query(
      `DELETE FROM hc_water_logs WHERE shopify_customer_id = $1`,
      [userId]
    );
    deletedCategories.push({ category: 'hydration', count: waterDelete.rowCount || 0 });

    // 3. Delete weight logs
    const weightDelete = await client.query(
      `DELETE FROM hc_weight_logs WHERE shopify_customer_id = $1`,
      [userId]
    );
    deletedCategories.push({ category: 'weight', count: weightDelete.rowCount || 0 });

    // 4. Delete health metrics
    const healthDelete = await client.query(
      `DELETE FROM hc_health_latest WHERE shopify_customer_id = $1`,
      [userId]
    );
    deletedCategories.push({ category: 'health_metrics', count: healthDelete.rowCount || 0 });

    // 5. Delete Apple Health daily data
    const appleDelete = await client.query(
      `DELETE FROM hc_apple_health_daily WHERE shopify_customer_id = $1`,
      [userId]
    );
    deletedCategories.push({ category: 'apple_health_daily', count: appleDelete.rowCount || 0 });

    // 6. Delete Apple tokens
    const appleTokensDelete = await client.query(
      `DELETE FROM hc_apple_tokens WHERE shopify_customer_id = $1`,
      [userId]
    );
    deletedCategories.push({ category: 'apple_tokens', count: appleTokensDelete.rowCount || 0 });

    // 7. Delete user preferences
    const prefsDelete = await client.query(
      `DELETE FROM hc_user_preferences WHERE shopify_customer_id = $1`,
      [userId]
    );
    deletedCategories.push({ category: 'preferences', count: prefsDelete.rowCount || 0 });

    // 8. Delete health devices
    const devicesDelete = await client.query(
      `DELETE FROM hc_health_devices WHERE shopify_customer_id = $1`,
      [userId]
    );
    deletedCategories.push({ category: 'devices', count: devicesDelete.rowCount || 0 });

    // 9. Delete pairing tokens
    const pairingDelete = await client.query(
      `DELETE FROM hc_pairing_tokens WHERE shopify_customer_id = $1`,
      [userId]
    );
    deletedCategories.push({ category: 'pairing_tokens', count: pairingDelete.rowCount || 0 });

    // 10. Delete wearable tokens
    const wearablesDelete = await client.query(
      `DELETE FROM wearable_tokens WHERE customer_id = $1`,
      [userId]
    );
    deletedCategories.push({ category: 'wearable_tokens', count: wearablesDelete.rowCount || 0 });

    // 11. Delete generated videos
    const videosDelete = await client.query(
      `DELETE FROM hc_user_videos WHERE user_id = $1`,
      [userId]
    );
    deletedCategories.push({ category: 'videos', count: videosDelete.rowCount || 0 });

    // 12. Anonymize audit logs (keep for SOC2 compliance, remove PII)
    const auditAnonymize = await client.query(`
      UPDATE audit_logs
      SET user_id = 'DELETED_USER',
          ip_address = NULL,
          user_agent = NULL,
          metadata = jsonb_set(
            COALESCE(metadata, '{}'::jsonb),
            '{anonymized}',
            'true'::jsonb
          )
      WHERE user_id = $1
    `, [userId]);

    await client.query('COMMIT');

    // Log completion
    await auditLogger.logGdpr(correlationId, 'DELETED_USER', AuditAction.GDPR_DELETE, ipAddress, {
      action: 'deletion_completed',
      originalUserId: userId,
      deletedCategories,
      anonymizedLogs: auditAnonymize.rowCount,
    });

    return {
      userId,
      deletedAt,
      deletedCategories,
      anonymizedAuditLogs: auditAnonymize.rowCount || 0,
      externalServicesNotified: ['HeyGen videos will expire automatically'],
    };

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Get data retention policy information
 */
export function getRetentionPolicy(): {
  policies: { dataType: string; retentionPeriod: string; action: string }[];
  lastUpdated: string;
} {
  return {
    policies: [
      { dataType: 'Health metrics', retentionPeriod: '2 years', action: 'Auto-delete' },
      { dataType: 'Meal logs', retentionPeriod: '2 years', action: 'Auto-delete' },
      { dataType: 'Weight logs', retentionPeriod: '2 years', action: 'Auto-delete' },
      { dataType: 'Hydration logs', retentionPeriod: '2 years', action: 'Auto-delete' },
      { dataType: 'Generated videos', retentionPeriod: '7 days', action: 'Auto-expire (HeyGen)' },
      { dataType: 'Audit logs', retentionPeriod: '7 years', action: 'Anonymize after user deletion' },
      { dataType: 'OAuth tokens', retentionPeriod: 'Until revoked', action: 'Delete on disconnect' },
      { dataType: 'Inactive accounts', retentionPeriod: '1 year', action: 'Notify → Delete' },
    ],
    lastUpdated: '2024-12-31',
  };
}

export default {
  exportUserData,
  deleteUserData,
  getRetentionPolicy,
};
