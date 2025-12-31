import { Router, Request, Response } from "express";
import { pool } from "../db/pool";

export const userRouter = Router();

/**
 * GET /api/v1/user/goals?shopifyCustomerId=...
 * Fetch user's nutrition goals
 */
userRouter.get("/goals", async (req: Request, res: Response) => {
  try {
    const shopifyCustomerId =
      (req.query.shopifyCustomerId as string) ||
      req.headers["x-shopify-customer-id"] as string;

    if (!shopifyCustomerId) {
      return res.status(400).json({
        ok: false,
        error: "shopifyCustomerId is required",
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
 * Body: { shopifyCustomerId, goals: { calories, protein, carbs, fat, hydration?, goalWeight?, timezone? } }
 */
userRouter.post("/goals", async (req: Request, res: Response) => {
  try {
    const { shopifyCustomerId, goals } = req.body;

    if (!shopifyCustomerId) {
      return res.status(400).json({
        ok: false,
        error: "shopifyCustomerId is required",
      });
    }

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

    // Upsert user preferences
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
        shopifyCustomerId,
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
