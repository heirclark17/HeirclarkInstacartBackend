/**
 * Authentication Routes
 * Handles JWT token generation for frontend clients
 */

import { Router, Request, Response } from 'express';
import { createToken } from '../middleware/auth';
import { sendSuccess, sendError } from '../middleware/responseHelper';

const router = Router();

/**
 * POST /api/v1/auth/token
 * Generate a JWT token for a Shopify customer
 *
 * Body: { shopifyCustomerId: string }
 * Returns: { token: string, expiresIn: string }
 *
 * This endpoint allows the frontend to exchange a Shopify customer ID
 * for a JWT token that can be used for authenticated API requests.
 */
router.post('/token', async (req: Request, res: Response) => {
  const { shopifyCustomerId } = req.body;

  if (!shopifyCustomerId) {
    return sendError(res, 'shopifyCustomerId is required', 400);
  }

  // Validate shopifyCustomerId format (basic validation)
  if (typeof shopifyCustomerId !== 'string' || shopifyCustomerId.trim().length === 0) {
    return sendError(res, 'Invalid shopifyCustomerId format', 400);
  }

  try {
    const secret = process.env.JWT_SECRET || 'default-secret-change-in-production';
    const expiresIn = '7d'; // 7 days

    // Generate JWT token
    const token = createToken(shopifyCustomerId, secret, expiresIn);

    sendSuccess(res, {
      token,
      expiresIn,
      tokenType: 'Bearer',
      customerId: shopifyCustomerId,
      message: 'Token generated successfully. Use this token in Authorization header: Bearer <token>'
    });
  } catch (error: any) {
    console.error('[auth/token] Token generation failed:', error);
    return sendError(res, 'Failed to generate token', 500);
  }
});

/**
 * GET /api/v1/auth/health
 * Health check for auth service
 */
router.get('/health', async (_req: Request, res: Response) => {
  sendSuccess(res, {
    status: 'healthy',
    service: 'authentication',
    timestamp: new Date().toISOString()
  });
});

export default router;
