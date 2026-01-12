import { Router, Response } from "express";
import { pool } from "../db/pool";
import { authMiddleware, getCustomerId, AuthenticatedRequest } from "../middleware/auth";
import { validateHealthMetrics } from "../middleware/validation";

export const userRouter = Router();

// ✅ SECURITY FIX: Apply STRICT authentication to all routes (OWASP A01: Broken Access Control)
// strictAuth: true blocks legacy X-Shopify-Customer-Id headers to prevent IDOR attacks
userRouter.use(authMiddleware({ strictAuth: true }));

/**
 * GET /api/v1/user/goals
 * Fetch user's nutrition goals
 *
 * ✅ SECURITY: Requires authentication via Bearer token or legacy auth (deprecated)
 * ✅ IDOR Protection: Uses validated customer ID from authMiddleware
 */
userRouter.get("/goals", async (req: AuthenticatedRequest, res: Response) => {
  try {
    // ✅ Extract validated customer ID from auth middleware
    const shopifyCustomerId = getCustomerId(req);

    if (!shopifyCustomerId) {
      return res.status(401).json({
        ok: false,
        error: "Authentication required",
      });
    }

    const result = await pool.query(
      `SELECT
        calories_target as calories,
        protein_target as protein,
        carbs_target as carbs,
        fat_target as fat,
        hydration_target_ml as hydration,
        goal_weight_lbs as "goalWeight",
        timezone
       FROM hc_user_preferences
       WHERE shopify_customer_id = $1`,
      [shopifyCustomerId]
    );

    if (result.rows.length === 0) {
      // Return default goals if no preferences exist
      return res.json({
        ok: true,
        goals: {
          calories: 2200,
          protein: 190,
          carbs: 190,
          fat: 60,
          hydration: 3000,
          goalWeight: null,
          timezone: "America/New_York",
        },
        isDefault: true,
      });
    }

    const row = result.rows[0];
    return res.json({
      ok: true,
      goals: {
        calories: row.calories || 2200,
        protein: row.protein || 190,
        carbs: row.carbs || 190,
        fat: row.fat || 60,
        hydration: row.hydration || 3000,
        goalWeight: row.goalWeight || null,
        timezone: row.timezone || "America/New_York",
      },
      isDefault: false,
    });
  } catch (err: any) {
    console.error("[User] GET /goals error:", err);
    return res.status(500).json({
      ok: false,
      error: err?.message || "Failed to fetch goals",
    });
  }
});

/**
 * POST /api/v1/user/goals
 * Save user's nutrition goals
 * Body: { goals: { calories, protein, carbs, fat, hydration?, goalWeight?, timezone? } }
 *
 * ✅ SECURITY: Requires authentication via Bearer token or legacy auth (deprecated)
 * ✅ IDOR Protection: Uses validated customer ID from authMiddleware
 * ✅ Input Validation: Validates numeric ranges for health metrics (OWASP A04)
 */
userRouter.post("/goals", validateHealthMetrics, async (req: AuthenticatedRequest, res: Response) => {
  try {
    // ✅ Extract validated customer ID from auth middleware
    const shopifyCustomerId = getCustomerId(req);

    if (!shopifyCustomerId) {
      return res.status(401).json({
        ok: false,
        error: "Authentication required",
      });
    }

    const { goals } = req.body;

    if (!goals || typeof goals !== "object") {
      return res.status(400).json({
        ok: false,
        error: "goals object is required",
      });
    }

    const {
      calories = 2200,
      protein = 190,
      carbs = 190,
      fat = 60,
      hydration = 3000,
      goalWeight = null,
      timezone = "America/New_York",
    } = goals;

    // ✅ Upsert user preferences using validated customer ID
    await pool.query(
      `INSERT INTO hc_user_preferences (
        shopify_customer_id,
        calories_target,
        protein_target,
        carbs_target,
        fat_target,
        hydration_target_ml,
        goal_weight_lbs,
        timezone,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      ON CONFLICT (shopify_customer_id) DO UPDATE SET
        calories_target = EXCLUDED.calories_target,
        protein_target = EXCLUDED.protein_target,
        carbs_target = EXCLUDED.carbs_target,
        fat_target = EXCLUDED.fat_target,
        hydration_target_ml = EXCLUDED.hydration_target_ml,
        goal_weight_lbs = EXCLUDED.goal_weight_lbs,
        timezone = EXCLUDED.timezone,
        updated_at = NOW()`,
      [
        shopifyCustomerId,  // ✅ Validated customer ID from JWT
        Number(calories) || 2200,
        Number(protein) || 190,
        Number(carbs) || 190,
        Number(fat) || 60,
        Number(hydration) || 3000,
        goalWeight ? Number(goalWeight) : null,
        timezone || "America/New_York",
      ]
    );

    console.log(`[User] Goals saved for customer ${shopifyCustomerId}`);

    return res.json({
      ok: true,
      message: "Goals saved successfully",
      goals: {
        calories: Number(calories) || 2200,
        protein: Number(protein) || 190,
        carbs: Number(carbs) || 190,
        fat: Number(fat) || 60,
        hydration: Number(hydration) || 3000,
        goalWeight: goalWeight ? Number(goalWeight) : null,
        timezone: timezone || "America/New_York",
      },
    });
  } catch (err: any) {
    console.error("[User] POST /goals error:", err);
    return res.status(500).json({
      ok: false,
      error: err?.message || "Failed to save goals",
    });
  }
});
