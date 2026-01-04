import { Router } from "express";
import { z } from "zod";
import { v4 as uuid } from "uuid";
import { pool } from "../db/pool";

export const favoritesRouter = Router();

// Schema for creating a favorite meal
const createFavoriteSchema = z.object({
  name: z.string().min(1).max(100),
  label: z.string().optional(), // breakfast, lunch, dinner, snack
  items: z.array(z.object({
    name: z.string(),
    calories: z.number().nonnegative(),
    protein: z.number().nonnegative(),
    carbs: z.number().nonnegative(),
    fat: z.number().nonnegative(),
    servingSize: z.string().optional(),
  })).min(1),
  totalCalories: z.number().nonnegative(),
  totalProtein: z.number().nonnegative(),
  totalCarbs: z.number().nonnegative(),
  totalFat: z.number().nonnegative(),
});

// POST /api/v1/favorites - Save a meal as favorite
favoritesRouter.post("/", async (req, res, next) => {
  try {
    const customerId = req.headers["x-shopify-customer-id"] as string;
    if (!customerId) {
      return res.status(401).json({ error: "Missing customer ID" });
    }

    const parsed = createFavoriteSchema.parse(req.body);

    const result = await pool.query(`
      INSERT INTO hc_meal_favorites (
        id, shopify_customer_id, name, label, items,
        total_calories, total_protein, total_carbs, total_fat
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [
      uuid(),
      customerId,
      parsed.name,
      parsed.label || null,
      JSON.stringify(parsed.items),
      parsed.totalCalories,
      parsed.totalProtein,
      parsed.totalCarbs,
      parsed.totalFat,
    ]);

    res.status(201).json({
      success: true,
      favorite: result.rows[0],
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/favorites - Get all favorites for a user
favoritesRouter.get("/", async (req, res, next) => {
  try {
    const customerId = req.headers["x-shopify-customer-id"] as string;
    if (!customerId) {
      return res.status(401).json({ error: "Missing customer ID" });
    }

    const result = await pool.query(`
      SELECT * FROM hc_meal_favorites
      WHERE shopify_customer_id = $1
      ORDER BY use_count DESC, created_at DESC
      LIMIT 50
    `, [customerId]);

    res.json({
      favorites: result.rows.map(row => ({
        id: row.id,
        name: row.name,
        label: row.label,
        items: row.items,
        totalCalories: row.total_calories,
        totalProtein: row.total_protein,
        totalCarbs: row.total_carbs,
        totalFat: row.total_fat,
        useCount: row.use_count,
        lastUsedAt: row.last_used_at,
        createdAt: row.created_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/favorites/:id - Remove a favorite
favoritesRouter.delete("/:id", async (req, res, next) => {
  try {
    const customerId = req.headers["x-shopify-customer-id"] as string;
    if (!customerId) {
      return res.status(401).json({ error: "Missing customer ID" });
    }

    const { id } = req.params;

    const result = await pool.query(`
      DELETE FROM hc_meal_favorites
      WHERE id = $1 AND shopify_customer_id = $2
      RETURNING id
    `, [id, customerId]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Favorite not found" });
    }

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/favorites/:id/log - Quick re-log a favorite meal
favoritesRouter.post("/:id/log", async (req, res, next) => {
  try {
    const customerId = req.headers["x-shopify-customer-id"] as string;
    if (!customerId) {
      return res.status(401).json({ error: "Missing customer ID" });
    }

    const { id } = req.params;
    const { label } = req.body; // Optional override for meal label

    // Get the favorite
    const favoriteResult = await pool.query(`
      SELECT * FROM hc_meal_favorites
      WHERE id = $1 AND shopify_customer_id = $2
    `, [id, customerId]);

    if (favoriteResult.rowCount === 0) {
      return res.status(404).json({ error: "Favorite not found" });
    }

    const favorite = favoriteResult.rows[0];

    // Create a new meal from the favorite
    const mealId = uuid();
    const mealLabel = label || favorite.label || "Snack";

    await pool.query(`
      INSERT INTO hc_meals (
        id, shopify_customer_id, datetime, label, items,
        total_calories, total_protein, total_carbs, total_fat, source
      )
      VALUES ($1, $2, NOW(), $3, $4, $5, $6, $7, $8, 'favorite')
    `, [
      mealId,
      customerId,
      mealLabel,
      JSON.stringify(favorite.items),
      favorite.total_calories,
      favorite.total_protein,
      favorite.total_carbs,
      favorite.total_fat,
    ]);

    // Update favorite usage stats
    await pool.query(`
      UPDATE hc_meal_favorites
      SET use_count = use_count + 1, last_used_at = NOW()
      WHERE id = $1
    `, [id]);

    res.status(201).json({
      success: true,
      mealId,
      message: `${favorite.name} logged as ${mealLabel}`,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/favorites/recent - Get recently logged meals (for auto-suggest)
favoritesRouter.get("/recent", async (req, res, next) => {
  try {
    const customerId = req.headers["x-shopify-customer-id"] as string;
    if (!customerId) {
      return res.status(401).json({ error: "Missing customer ID" });
    }

    const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);

    // Get recent unique meals (by name/items combo)
    const result = await pool.query(`
      SELECT DISTINCT ON (label, items::text)
        id, label, items, total_calories, total_protein, total_carbs, total_fat, datetime
      FROM hc_meals
      WHERE shopify_customer_id = $1
      ORDER BY label, items::text, datetime DESC
      LIMIT $2
    `, [customerId, limit]);

    res.json({
      recentMeals: result.rows.map(row => ({
        id: row.id,
        label: row.label,
        items: row.items,
        totalCalories: row.total_calories,
        totalProtein: row.total_protein,
        totalCarbs: row.total_carbs,
        totalFat: row.total_fat,
        lastLoggedAt: row.datetime,
      })),
    });
  } catch (err) {
    next(err);
  }
});
