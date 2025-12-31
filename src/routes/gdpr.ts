// src/routes/gdpr.ts
// GDPR Data Subject Rights endpoints
// GDPR Articles: Art. 17 Right to Erasure, Art. 20 Data Portability

import { Router, Request, Response } from 'express';
import { authMiddleware, AuthenticatedRequest, getCustomerId } from '../middleware/auth';
import { strictRateLimitMiddleware } from '../middleware/rateLimiter';
import { exportUserData, deleteUserData, getRetentionPolicy } from '../services/gdprService';

export const gdprRouter = Router();

// Apply auth and strict rate limiting to all GDPR routes
gdprRouter.use(authMiddleware());
gdprRouter.use(strictRateLimitMiddleware());

/**
 * Helper to get client IP
 */
function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const ips = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0];
    return ips?.trim() || 'unknown';
  }
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

/**
 * GET /api/v1/gdpr/export
 * Export all user data (GDPR Article 20 - Right to Data Portability)
 *
 * Returns a complete JSON export of all data associated with the authenticated user.
 * The export is provided in a portable format that can be used with other services.
 */
gdprRouter.get('/export', async (req: AuthenticatedRequest, res: Response) => {
  const customerId = getCustomerId(req);

  if (!customerId) {
    return res.status(401).json({
      ok: false,
      error: 'Authentication required for data export',
    });
  }

  try {
    console.log(`[gdpr] Data export requested by user ${customerId}`);

    const exportData = await exportUserData(customerId, getClientIp(req));

    // Set headers for download
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="heirclark-data-export-${customerId}-${Date.now()}.json"`);

    return res.json({
      ok: true,
      message: 'Data export successful. This file contains all your personal data.',
      gdprArticle: 'Article 20 - Right to Data Portability',
      data: exportData,
    });
  } catch (err: any) {
    console.error('[gdpr] Export failed:', err);
    return res.status(500).json({
      ok: false,
      error: 'Data export failed. Please try again or contact support.',
    });
  }
});

/**
 * DELETE /api/v1/gdpr/delete
 * Permanently delete all user data (GDPR Article 17 - Right to Erasure)
 *
 * This action is IRREVERSIBLE. All user data will be permanently deleted.
 * Audit logs are anonymized (retained for SOC2 compliance).
 *
 * Requires confirmation header: X-Confirm-Delete: PERMANENTLY_DELETE_ALL_MY_DATA
 */
gdprRouter.delete('/delete', async (req: AuthenticatedRequest, res: Response) => {
  const customerId = getCustomerId(req);

  if (!customerId) {
    return res.status(401).json({
      ok: false,
      error: 'Authentication required for data deletion',
    });
  }

  // Require explicit confirmation header to prevent accidental deletion
  const confirmHeader = req.headers['x-confirm-delete'] as string;
  if (confirmHeader !== 'PERMANENTLY_DELETE_ALL_MY_DATA') {
    return res.status(400).json({
      ok: false,
      error: 'Deletion requires confirmation',
      instructions: 'Add header: X-Confirm-Delete: PERMANENTLY_DELETE_ALL_MY_DATA',
      warning: 'This action is IRREVERSIBLE. All your data will be permanently deleted.',
    });
  }

  try {
    console.log(`[gdpr] Data deletion requested by user ${customerId}`);

    const result = await deleteUserData(customerId, getClientIp(req));

    return res.json({
      ok: true,
      message: 'All your data has been permanently deleted.',
      gdprArticle: 'Article 17 - Right to Erasure',
      result: {
        deletedAt: result.deletedAt,
        deletedCategories: result.deletedCategories,
        anonymizedAuditLogs: result.anonymizedAuditLogs,
        notes: [
          'Audit logs have been anonymized but retained for compliance.',
          'HeyGen-generated videos will expire automatically within 7 days.',
          'You may need to revoke Fitbit access separately at fitbit.com.',
        ],
      },
    });
  } catch (err: any) {
    console.error('[gdpr] Deletion failed:', err);
    return res.status(500).json({
      ok: false,
      error: 'Data deletion failed. Please try again or contact support.',
    });
  }
});

/**
 * GET /api/v1/gdpr/retention
 * View data retention policy
 *
 * Returns the current data retention policies for all data categories.
 */
gdprRouter.get('/retention', (_req: Request, res: Response) => {
  const policy = getRetentionPolicy();

  return res.json({
    ok: true,
    gdprArticle: 'Article 5(1)(e) - Storage Limitation',
    retentionPolicy: policy,
    contact: {
      dataProtectionOfficer: 'privacy@heirclark.com',
      supportEmail: 'support@heirclark.com',
    },
  });
});

/**
 * GET /api/v1/gdpr/info
 * Get information about GDPR rights and how to exercise them
 */
gdprRouter.get('/info', (_req: Request, res: Response) => {
  return res.json({
    ok: true,
    title: 'Your Data Privacy Rights (GDPR)',
    rights: [
      {
        name: 'Right to Access (Article 15)',
        description: 'You can request a copy of all personal data we hold about you.',
        howToExercise: 'GET /api/v1/gdpr/export',
      },
      {
        name: 'Right to Data Portability (Article 20)',
        description: 'You can download your data in a machine-readable format.',
        howToExercise: 'GET /api/v1/gdpr/export',
      },
      {
        name: 'Right to Erasure (Article 17)',
        description: 'You can request permanent deletion of all your data.',
        howToExercise: 'DELETE /api/v1/gdpr/delete (with confirmation header)',
      },
      {
        name: 'Right to Rectification (Article 16)',
        description: 'You can correct inaccurate personal data.',
        howToExercise: 'Update via app settings or contact support.',
      },
      {
        name: 'Right to Restriction (Article 18)',
        description: 'You can request restriction of processing.',
        howToExercise: 'Contact privacy@heirclark.com',
      },
      {
        name: 'Right to Object (Article 21)',
        description: 'You can object to processing of your data.',
        howToExercise: 'Contact privacy@heirclark.com',
      },
    ],
    dataController: {
      name: 'HeirClark',
      contact: 'privacy@heirclark.com',
    },
    supervisoryAuthority: {
      note: 'You have the right to lodge a complaint with a supervisory authority.',
    },
  });
});

export default gdprRouter;
