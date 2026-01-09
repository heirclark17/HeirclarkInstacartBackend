// src/routes/foodPreferences.ts
import { Router, Request, Response } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/asyncHandler";
import { authMiddleware, AuthenticatedRequest } from "../middleware/auth";
import {
  sendSuccess,
  sendError,
  sendValidationError,
} from "../middleware/responseHelper";
import { pool } from "../db/pool";

export const foodPreferencesRouter = Router();

// Apply auth middleware to all routes
foodPreferencesRouter.use(authMiddleware({ required: true }));

/**
 * Food preferences schema
 */
const foodPreferencesSchema = z.object({
  mealStyle: z.enum(["threePlusSnacks", "fewerLarger"]),
  favoriteProteins: z.array(z.string()).min(1),
  favoriteFruits: z.array(z.string()).min(1),
  favoriteCuisines: z.array(z.string()).min(1),
  topFoods: z.array(z.string()).length(3),
  hatedFoods: z.string().max(200),
  cheatDays: z.array(z.string()),
  eatOutFrequency: z.number().min(0).max(7),
  favoriteSnacks: z.array(z.string()).min(1),
  mealDiversity: z.enum(["diverse", "sameDaily"]),
});

type FoodPreferencesData = z.infer<typeof foodPreferencesSchema>;

/**
 * GET /api/v1/food-preferences
 *
 * Get user's food preferences
 */
foodPreferencesRouter.get(
  "/",
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const customerId = req.auth?.customerId;
    if (!customerId) {
      return sendError(res, "Missing customer ID", 400);
    }

    const result = await pool.query(
      `SELECT * FROM food_preferences WHERE customer_id = $1`,
      [customerId]
    );

    if (result.rows.length === 0) {
      return sendSuccess(res, null);
    }

    const prefs = result.rows[0];
    return sendSuccess(res, {
      mealStyle: prefs.meal_style,
      favoriteProteins: prefs.favorite_proteins,
      favoriteFruits: prefs.favorite_fruits,
      favoriteCuisines: prefs.favorite_cuisines,
      topFoods: prefs.top_foods,
      hatedFoods: prefs.hated_foods,
      cheatDays: prefs.cheat_days,
      eatOutFrequency: prefs.eat_out_frequency,
      favoriteSnacks: prefs.favorite_snacks,
      mealDiversity: prefs.meal_diversity,
      createdAt: prefs.created_at,
      updatedAt: prefs.updated_at,
    });
  })
);

/**
 * POST /api/v1/food-preferences
 *
 * Create or update food preferences
 */
foodPreferencesRouter.post(
  "/",
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const customerId = req.auth?.customerId;
    if (!customerId) {
      return sendError(res, "Missing customer ID", 400);
    }

    // Validate request body
    const parseResult = foodPreferencesSchema.safeParse(req.body);
    if (!parseResult.success) {
      return sendValidationError(
        res,
        parseResult.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`)
      );
    }

    const data = parseResult.data;

    // Upsert food preferences
    const result = await pool.query(
      `
      INSERT INTO food_preferences (
        customer_id,
        meal_style,
        favorite_proteins,
        favorite_fruits,
        favorite_cuisines,
        top_foods,
        hated_foods,
        cheat_days,
        eat_out_frequency,
        favorite_snacks,
        meal_diversity,
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
      ON CONFLICT (customer_id)
      DO UPDATE SET
        meal_style = EXCLUDED.meal_style,
        favorite_proteins = EXCLUDED.favorite_proteins,
        favorite_fruits = EXCLUDED.favorite_fruits,
        favorite_cuisines = EXCLUDED.favorite_cuisines,
        top_foods = EXCLUDED.top_foods,
        hated_foods = EXCLUDED.hated_foods,
        cheat_days = EXCLUDED.cheat_days,
        eat_out_frequency = EXCLUDED.eat_out_frequency,
        favorite_snacks = EXCLUDED.favorite_snacks,
        meal_diversity = EXCLUDED.meal_diversity,
        updated_at = NOW()
      RETURNING *
      `,
      [
        customerId,
        data.mealStyle,
        data.favoriteProteins,
        data.favoriteFruits,
        data.favoriteCuisines,
        data.topFoods,
        data.hatedFoods,
        data.cheatDays,
        data.eatOutFrequency,
        data.favoriteSnacks,
        data.mealDiversity,
      ]
    );

    const prefs = result.rows[0];
    return sendSuccess(res, {
      mealStyle: prefs.meal_style,
      favoriteProteins: prefs.favorite_proteins,
      favoriteFruits: prefs.favorite_fruits,
      favoriteCuisines: prefs.favorite_cuisines,
      topFoods: prefs.top_foods,
      hatedFoods: prefs.hated_foods,
      cheatDays: prefs.cheat_days,
      eatOutFrequency: prefs.eat_out_frequency,
      favoriteSnacks: prefs.favorite_snacks,
      mealDiversity: prefs.meal_diversity,
      createdAt: prefs.created_at,
      updatedAt: prefs.updated_at,
    });
  })
);

/**
 * PUT /api/v1/food-preferences
 *
 * Update food preferences (alias for POST)
 */
foodPreferencesRouter.put(
  "/",
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    // Reuse POST logic
    return foodPreferencesRouter.handle(
      { ...req, method: "POST" } as any,
      res,
      () => {}
    );
  })
);

/**
 * DELETE /api/v1/food-preferences
 *
 * Delete food preferences
 */
foodPreferencesRouter.delete(
  "/",
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const customerId = req.auth?.customerId;
    if (!customerId) {
      return sendError(res, "Missing customer ID", 400);
    }

    await pool.query(
      `DELETE FROM food_preferences WHERE customer_id = $1`,
      [customerId]
    );

    return sendSuccess(res, { deleted: true });
  })
);

export default foodPreferencesRouter;
