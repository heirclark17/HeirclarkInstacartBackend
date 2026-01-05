// src/routes/nutritionFoods.ts
// Nutrition Foods API Routes
// Provides search, verification, and cart analysis endpoints

import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import crypto from 'crypto';
import { NutritionGraphDB } from '../db/nutritionGraph';
import {
  FoodSearchFilters,
  FoodVerificationRequest,
  CartItem,
  CartAnalysis,
  NutritionApiResponse,
  NutritionFood,
  DietaryFlag,
} from '../types/nutrition';

export function createNutritionFoodsRouter(pool: Pool): Router {
  const router = Router();
  const nutritionDB = new NutritionGraphDB(pool);

  // ==========================================================================
  // GET /api/v1/nutrition/foods/search
  // Search foods with filters
  // ==========================================================================
  router.get('/foods/search', async (req: Request, res: Response) => {
    try {
      const filters: FoodSearchFilters = {
        query: req.query.q as string,
        category: req.query.category as string,
        brand: req.query.brand as string,
        dietary_flags: req.query.dietary_flags
          ? (req.query.dietary_flags as string).split(',') as DietaryFlag[]
          : undefined,
        min_protein_g: req.query.min_protein_g
          ? parseFloat(req.query.min_protein_g as string)
          : undefined,
        max_calories: req.query.max_calories
          ? parseFloat(req.query.max_calories as string)
          : undefined,
        max_carbs_g: req.query.max_carbs_g
          ? parseFloat(req.query.max_carbs_g as string)
          : undefined,
        verification_status: req.query.verification_status
          ? (req.query.verification_status as string).split(',') as any[]
          : undefined,
        has_store_mapping: req.query.has_store_mapping === 'true',
        store: req.query.store as string,
      };

      const page = parseInt(req.query.page as string) || 1;
      const pageSize = Math.min(parseInt(req.query.page_size as string) || 20, 100);

      const result = await nutritionDB.searchFoods(filters, page, pageSize);

      const response: NutritionApiResponse<typeof result> = {
        ok: true,
        data: result,
        meta: {
          request_id: req.headers['x-request-id'] as string || crypto.randomUUID(),
          processing_time_ms: 0, // Would calculate actual time
        },
      };

      return res.json(response);
    } catch (error: any) {
      console.error('[NutritionFoods] Search error:', error);
      return res.status(500).json({
        ok: false,
        error: 'Search failed',
        details: error.message || 'Unknown error',
      });
    }
  });

  // ==========================================================================
  // GET /api/v1/nutrition/foods/:id
  // Get food by ID
  // ==========================================================================
  router.get('/foods/:id', async (req: Request, res: Response) => {
    try {
      const food = await nutritionDB.getFoodById(req.params.id);

      if (!food) {
        return res.status(404).json({
          ok: false,
          error: 'Food not found',
        });
      }

      return res.json({
        ok: true,
        data: food,
      });
    } catch (error) {
      console.error('[NutritionFoods] Get by ID error:', error);
      return res.status(500).json({
        ok: false,
        error: 'Failed to get food',
      });
    }
  });

  // ==========================================================================
  // GET /api/v1/nutrition/foods/upc/:upc
  // Get food by UPC barcode
  // ==========================================================================
  router.get('/foods/upc/:upc', async (req: Request, res: Response) => {
    try {
      const food = await nutritionDB.getFoodByUpc(req.params.upc);

      if (!food) {
        return res.status(404).json({
          ok: false,
          error: 'Food not found for UPC',
        });
      }

      return res.json({
        ok: true,
        data: food,
      });
    } catch (error) {
      console.error('[NutritionFoods] Get by UPC error:', error);
      return res.status(500).json({
        ok: false,
        error: 'Failed to get food by UPC',
      });
    }
  });

  // ==========================================================================
  // POST /api/v1/nutrition/foods
  // Create a new food entry
  // ==========================================================================
  router.post('/foods', async (req: Request, res: Response) => {
    try {
      const foodData = req.body;

      // Validate required fields
      if (!foodData.name) {
        return res.status(400).json({
          ok: false,
          error: 'Name is required',
        });
      }

      const food = await nutritionDB.createFood(foodData);

      return res.status(201).json({
        ok: true,
        data: food,
      });
    } catch (error) {
      console.error('[NutritionFoods] Create error:', error);
      return res.status(500).json({
        ok: false,
        error: 'Failed to create food',
      });
    }
  });

  // ==========================================================================
  // POST /api/v1/nutrition/foods/verify
  // Verify or modify a food entry (admin endpoint)
  // ==========================================================================
  router.post('/foods/verify', async (req: Request, res: Response) => {
    try {
      const verificationRequest: FoodVerificationRequest = req.body;

      // Validate request
      if (!verificationRequest.food_id) {
        return res.status(400).json({
          ok: false,
          error: 'food_id is required',
        });
      }

      if (!verificationRequest.action) {
        return res.status(400).json({
          ok: false,
          error: 'action is required (approve, reject, merge, edit)',
        });
      }

      if (!verificationRequest.verified_by) {
        return res.status(400).json({
          ok: false,
          error: 'verified_by is required',
        });
      }

      const result = await nutritionDB.verifyFood(verificationRequest);

      return res.json({
        ok: true,
        data: result,
      });
    } catch (error: any) {
      console.error('[NutritionFoods] Verify error:', error);
      return res.status(500).json({
        ok: false,
        error: error.message || 'Verification failed',
      });
    }
  });

  // ==========================================================================
  // POST /api/v1/nutrition/foods/:id/store-mapping
  // Add store mapping to a food
  // ==========================================================================
  router.post('/foods/:id/store-mapping', async (req: Request, res: Response) => {
    try {
      const foodId = req.params.id;
      const mapping = req.body;

      // Validate required fields
      if (!mapping.store || !mapping.product_id || !mapping.product_name) {
        return res.status(400).json({
          ok: false,
          error: 'store, product_id, and product_name are required',
        });
      }

      await nutritionDB.addStoreMapping(foodId, mapping);

      return res.json({
        ok: true,
        message: 'Store mapping added',
      });
    } catch (error) {
      console.error('[NutritionFoods] Add store mapping error:', error);
      return res.status(500).json({
        ok: false,
        error: 'Failed to add store mapping',
      });
    }
  });

  // ==========================================================================
  // POST /api/v1/nutrition/plan/from-cart
  // Analyze a cart and generate meal suggestions
  // ==========================================================================
  router.post('/plan/from-cart', async (req: Request, res: Response) => {
    try {
      const { cart_items, target_days = 7 }: {
        cart_items: CartItem[];
        target_days?: number;
      } = req.body;

      if (!cart_items || !Array.isArray(cart_items) || cart_items.length === 0) {
        return res.status(400).json({
          ok: false,
          error: 'cart_items array is required',
        });
      }

      // Analyze cart
      const analysis = await analyzeCart(nutritionDB, cart_items, target_days);

      return res.json({
        ok: true,
        data: analysis,
      });
    } catch (error) {
      console.error('[NutritionFoods] Cart analysis error:', error);
      return res.status(500).json({
        ok: false,
        error: 'Cart analysis failed',
      });
    }
  });

  // ==========================================================================
  // GET /api/v1/nutrition/categories
  // Get list of food categories
  // ==========================================================================
  router.get('/categories', async (req: Request, res: Response) => {
    try {
      const result = await pool.query(`
        SELECT category, COUNT(*) as count
        FROM nutrition_foods
        WHERE category IS NOT NULL
        GROUP BY category
        ORDER BY count DESC
      `);

      return res.json({
        ok: true,
        data: result.rows,
      });
    } catch (error) {
      console.error('[NutritionFoods] Categories error:', error);
      return res.status(500).json({
        ok: false,
        error: 'Failed to get categories',
      });
    }
  });

  // ==========================================================================
  // GET /api/v1/nutrition/brands
  // Get list of brands with filters
  // ==========================================================================
  router.get('/brands', async (req: Request, res: Response) => {
    try {
      const query = req.query.q as string;
      let sql = `
        SELECT brand, COUNT(*) as count
        FROM nutrition_foods
        WHERE brand IS NOT NULL
      `;
      const params: any[] = [];

      if (query) {
        sql += ` AND lower(brand) LIKE $1`;
        params.push(`%${query.toLowerCase()}%`);
      }

      sql += ` GROUP BY brand ORDER BY count DESC LIMIT 100`;

      const result = await pool.query(sql, params);

      return res.json({
        ok: true,
        data: result.rows,
      });
    } catch (error) {
      console.error('[NutritionFoods] Brands error:', error);
      return res.status(500).json({
        ok: false,
        error: 'Failed to get brands',
      });
    }
  });

  return router;
}

// ==========================================================================
// Cart Analysis Helper
// ==========================================================================
async function analyzeCart(
  db: NutritionGraphDB,
  cartItems: CartItem[],
  targetDays: number
): Promise<CartAnalysis> {
  let totalCostCents = 0;
  const totalNutrients = {
    calories: 0,
    protein_g: 0,
    carbs_g: 0,
    fat_g: 0,
    fiber_g: 0,
    sugar_g: 0,
    sodium_mg: 0,
  };

  const analyzedItems: CartItem[] = [];
  const unmappedItems: string[] = [];

  for (const item of cartItems) {
    totalCostCents += item.price_cents * item.quantity;

    // Try to find nutrition info
    if (item.nutrition_food_id) {
      const food = await db.getFoodById(item.nutrition_food_id);
      if (food) {
        const servings = item.quantity; // Simplified - would need unit conversion
        totalNutrients.calories += (food.nutrients.calories || 0) * servings;
        totalNutrients.protein_g += (food.nutrients.protein_g || 0) * servings;
        totalNutrients.carbs_g += (food.nutrients.carbs_g || 0) * servings;
        totalNutrients.fat_g += (food.nutrients.fat_g || 0) * servings;
        totalNutrients.fiber_g += (food.nutrients.fiber_g || 0) * servings;
        totalNutrients.sugar_g += (food.nutrients.sugar_g || 0) * servings;
        totalNutrients.sodium_mg += (food.nutrients.sodium_mg || 0) * servings;
      }
    } else {
      unmappedItems.push(item.product_name);
    }

    analyzedItems.push(item);
  }

  // Calculate daily averages
  const dailyNutrients = {
    calories: Math.round(totalNutrients.calories / targetDays),
    protein_g: Math.round(totalNutrients.protein_g / targetDays),
    carbs_g: Math.round(totalNutrients.carbs_g / targetDays),
    fat_g: Math.round(totalNutrients.fat_g / targetDays),
    fiber_g: Math.round(totalNutrients.fiber_g / targetDays),
    sugar_g: Math.round(totalNutrients.sugar_g / targetDays),
    sodium_mg: Math.round(totalNutrients.sodium_mg / targetDays),
  };

  // Check for protein gaps (assuming 150g/day target for active person)
  const targetDailyProtein = 150;
  const proteinGap = Math.max(0, targetDailyProtein - dailyNutrients.protein_g);

  // Find high-protein suggestions if there's a gap
  let suggestedAdditions: NutritionFood[] = [];
  if (proteinGap > 20) {
    const highProteinSearch = await db.searchFoods({
      min_protein_g: 20,
      max_calories: 300,
      has_store_mapping: true,
    }, 1, 5);
    suggestedAdditions = highProteinSearch.foods;
  }

  return {
    cart_items: analyzedItems,
    total_cost_cents: totalCostCents,
    total_nutrients: totalNutrients,
    estimated_days: targetDays,
    daily_nutrients: dailyNutrients,
    protein_gap_g: proteinGap > 0 ? proteinGap : undefined,
    suggested_additions: suggestedAdditions.length > 0 ? suggestedAdditions : undefined,
    can_support_plan: unmappedItems.length < cartItems.length * 0.5,
    missing_for_plan: unmappedItems.length > 0 ? unmappedItems : undefined,
  };
}

export default createNutritionFoodsRouter;
