// src/routes/groceryBudget.ts
// Grocery Budget API Routes for Heirclark
// Integrates meal planning with budget optimization and store cart generation

import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { MealPlanAIService, MealPlanConstraints, BudgetConstraints, PantryItem } from '../services/mealPlanAI';
import { GroceryOptimizer, BUDGET_TIERS } from '../services/groceryOptimizer';

// ==========================================================================
// Instacart API Configuration
// ==========================================================================
const INSTACART_BASE_URL = process.env.INSTACART_ENV === 'production'
  ? "https://connect.instacart.com"
  : "https://connect.dev.instacart.tools";
const INSTACART_API_KEY = process.env.INSTACART_API_KEY || "";

// ==========================================================================
// Helper: Create Instacart products link from grocery list
// ==========================================================================
interface GroceryItem {
  name: string;
  total_amount: number;
  unit: string;
  category?: string;
}

async function createInstacartLink(
  groceryList: GroceryItem[],
  landingUrl: string = 'https://heirclark.com/meal-plan'
): Promise<{ link_url: string; items_count: number } | null> {
  if (!INSTACART_API_KEY) {
    console.warn('[GroceryBudget] INSTACART_API_KEY not set, skipping cart creation');
    return null;
  }

  // Convert grocery list to Instacart-friendly format with better product names
  const instacartItems = groceryList.map(item => {
    // Map generic names to better Instacart search terms
    const nameMapping: Record<string, string> = {
      'chicken breast': 'Boneless Skinless Chicken Breast',
      'salmon fillet': 'Atlantic Salmon Fillet',
      'ground turkey': 'Lean Ground Turkey',
      'greek yogurt': 'Plain Greek Yogurt',
      'mixed vegetables': 'Frozen Mixed Vegetables',
      'mixed berries': 'Frozen Mixed Berries',
      'sweet potato': 'Sweet Potato',
      'brown rice': 'Long Grain Brown Rice',
      'rice': 'Long Grain White Rice',
      'quinoa': 'Organic Quinoa',
      'oats': 'Old Fashioned Rolled Oats',
      'eggs': 'Large Grade A Eggs',
      'whole grain bread': 'Whole Wheat Bread',
      'broccoli': 'Fresh Broccoli',
      'spinach': 'Fresh Baby Spinach',
      'protein source': 'Chicken Breast',
      'vegetables': 'Frozen Mixed Vegetables',
    };

    const lowerName = item.name.toLowerCase();
    const instacartName = nameMapping[lowerName] || item.name;

    // Calculate sensible quantities
    let quantity = 1;
    if (item.unit === 'g' && item.total_amount > 400) {
      quantity = Math.ceil(item.total_amount / 400);
    } else if (item.unit === 'large' && item.total_amount > 12) {
      quantity = Math.ceil(item.total_amount / 12); // dozens
    }

    return {
      name: instacartName,
      quantity,
      unit: item.unit === 'g' ? 'each' : item.unit,
    };
  });

  try {
    const response = await fetch(`${INSTACART_BASE_URL}/idp/v1/products/products_link`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${INSTACART_API_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        title: 'Weekly Meal Plan Groceries',
        line_items: instacartItems,
        landing_page_configuration: {
          partner_linkback_url: landingUrl,
        },
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('[GroceryBudget] Instacart products link error:', response.status, data);
      return null;
    }

    return {
      link_url: data.products_link_url || data.link_url,
      items_count: instacartItems.length,
    };
  } catch (error) {
    console.error('[GroceryBudget] Failed to create Instacart link:', error);
    return null;
  }
}

// ==========================================================================
// Router Factory
// ==========================================================================

export function createGroceryBudgetRouter(pool: Pool): Router {
  const router = Router();
  const mealPlanService = new MealPlanAIService(pool);
  const groceryOptimizer = new GroceryOptimizer(pool);

  // ==========================================================================
  // POST /api/v1/ai/plan-with-cart
  // Generate meal plan with budget optimization and cart generation
  // ==========================================================================
  router.post('/plan-with-cart', async (req: Request, res: Response) => {
    try {
      const {
        // Nutrition constraints
        daily_calories,
        daily_protein_g,
        daily_carbs_g,
        daily_fat_g,
        dietary_restrictions,
        allergies,
        cuisine_preferences,
        cooking_skill,
        max_prep_time_minutes,
        meals_per_day,

        // Budget constraints
        weekly_budget_cents,
        budget_tier,  // 'budget', 'moderate', 'premium'
        preferred_stores,
        prioritize_sales,

        // Pantry
        pantry_items,

        // Options
        generate_cart,  // Whether to generate Instacart cart
        optimize_budget,  // Whether to run budget optimizer
      } = req.body;

      // Build constraints
      const constraints: MealPlanConstraints = {
        daily_calories: daily_calories || 2000,
        daily_protein_g: daily_protein_g || 150,
        daily_carbs_g: daily_carbs_g || 200,
        daily_fat_g: daily_fat_g || 70,
        dietary_restrictions,
        allergies,
        cuisine_preferences,
        cooking_skill: cooking_skill || 'intermediate',
        max_prep_time_minutes: max_prep_time_minutes || 45,
        meals_per_day: meals_per_day || 3,
      };

      // Determine budget from tier if not specified
      let budgetCents = weekly_budget_cents;
      if (!budgetCents && budget_tier) {
        const tier = BUDGET_TIERS.find(t => t.name === budget_tier);
        if (tier) {
          budgetCents = Math.round((tier.weekly_min_cents + tier.weekly_max_cents) / 2);
        }
      }

      const budget: BudgetConstraints | undefined = budgetCents
        ? {
            weekly_budget_cents: budgetCents,
            preferred_stores: preferred_stores || ['instacart'],
            prioritize_sales,
          }
        : undefined;

      const pantry: PantryItem[] | undefined = pantry_items?.map((item: any) => ({
        name: item.name || item,
        quantity: item.quantity,
        unit: item.unit,
      }));

      // Generate the meal plan
      console.log('[GroceryBudget] Generating meal plan with constraints:', {
        calories: constraints.daily_calories,
        protein: constraints.daily_protein_g,
        budget: budgetCents ? `$${(budgetCents / 100).toFixed(2)}` : 'none',
        pantryItems: pantry?.length || 0,
      });

      let plan = await mealPlanService.generateWeekPlan(constraints, pantry, budget);

      // Adjust for pantry items
      let pantryAdjustment;
      if (pantry && pantry.length > 0) {
        pantryAdjustment = await groceryOptimizer.adjustForPantry(plan.grocery_list, pantry);
        plan.grocery_list = pantryAdjustment.grocery_list;
        if (plan.weekly_cost_cents) {
          plan.weekly_cost_cents -= pantryAdjustment.cost_reduction_cents;
        }
      }

      // Optimize for budget if requested
      let optimization;
      if (optimize_budget && budgetCents && plan.weekly_cost_cents && plan.weekly_cost_cents > budgetCents) {
        optimization = await groceryOptimizer.optimizeForBudget(
          plan.grocery_list,
          budgetCents,
          preferred_stores || ['instacart']
        );
      }

      // Suggest budget swaps
      let budgetSwaps;
      if (budget_tier === 'budget') {
        const allMeals = plan.days.flatMap(d => d.meals);
        budgetSwaps = await groceryOptimizer.suggestBudgetSwaps(allMeals, 'budget');
      }

      // Generate Instacart cart if requested
      let instacartCart;
      if (generate_cart !== false) {
        instacartCart = await groceryOptimizer.generateInstacartCart(
          plan.grocery_list,
          preferred_stores?.[0]
        );
      }

      // Generate AI explanation
      const explanation = await mealPlanService.explainPlanToUser(plan, constraints);

      return res.json({
        ok: true,
        data: {
          plan,
          explanation,
          pantry_adjustment: pantryAdjustment
            ? {
                items_from_pantry: pantryAdjustment.items_removed,
                savings_cents: pantryAdjustment.cost_reduction_cents,
              }
            : undefined,
          budget_optimization: optimization,
          budget_swaps: budgetSwaps?.slice(0, 5),  // Top 5 swaps
          instacart_cart: instacartCart,
        },
      });
    } catch (error: any) {
      console.error('[GroceryBudget] Plan with cart error:', error);
      return res.status(500).json({
        ok: false,
        error: 'Failed to generate meal plan with cart',
        details: error.message || 'Unknown error',
      });
    }
  });

  // ==========================================================================
  // POST /api/v1/grocery/plan-to-instacart
  // Single endpoint: Generate meal plan AND create Instacart cart
  // ==========================================================================
  router.post('/plan-to-instacart', async (req: Request, res: Response) => {
    try {
      const {
        // Nutrition constraints
        daily_calories,
        daily_protein_g,
        daily_carbs_g,
        daily_fat_g,
        dietary_restrictions,
        allergies,
        cuisine_preferences,
        cooking_skill,
        max_prep_time_minutes,
        meals_per_day,

        // Budget constraints
        weekly_budget_cents,
        budget_tier,
        preferred_stores,

        // Pantry
        pantry_items,

        // Instacart options
        landing_url,
      } = req.body;

      // Build constraints
      const constraints: MealPlanConstraints = {
        daily_calories: daily_calories || 2000,
        daily_protein_g: daily_protein_g || 150,
        daily_carbs_g: daily_carbs_g || 200,
        daily_fat_g: daily_fat_g || 70,
        dietary_restrictions,
        allergies,
        cuisine_preferences,
        cooking_skill: cooking_skill || 'intermediate',
        max_prep_time_minutes: max_prep_time_minutes || 45,
        meals_per_day: meals_per_day || 3,
      };

      // Determine budget from tier if not specified
      let budgetCents = weekly_budget_cents;
      if (!budgetCents && budget_tier) {
        const tier = BUDGET_TIERS.find(t => t.name === budget_tier);
        if (tier) {
          budgetCents = Math.round((tier.weekly_min_cents + tier.weekly_max_cents) / 2);
        }
      }

      const budget: BudgetConstraints | undefined = budgetCents
        ? {
            weekly_budget_cents: budgetCents,
            preferred_stores: preferred_stores || ['instacart'],
          }
        : undefined;

      const pantry: PantryItem[] | undefined = pantry_items?.map((item: any) => ({
        name: item.name || item,
        quantity: item.quantity,
        unit: item.unit,
      }));

      console.log('[GroceryBudget] Plan-to-Instacart starting:', {
        calories: constraints.daily_calories,
        protein: constraints.daily_protein_g,
        budget: budgetCents ? `$${(budgetCents / 100).toFixed(2)}` : 'none',
      });

      // Step 1: Generate meal plan
      let plan = await mealPlanService.generateWeekPlan(constraints, pantry, budget);

      // Step 2: Adjust for pantry items
      let pantryAdjustment;
      if (pantry && pantry.length > 0) {
        pantryAdjustment = await groceryOptimizer.adjustForPantry(plan.grocery_list, pantry);
        plan.grocery_list = pantryAdjustment.grocery_list;
        if (plan.weekly_cost_cents) {
          plan.weekly_cost_cents -= pantryAdjustment.cost_reduction_cents;
        }
      }

      // Step 3: Create Instacart cart directly from grocery list
      const instacartResult = await createInstacartLink(
        plan.grocery_list,
        landing_url || 'https://heirclark.com/meal-plan'
      );

      console.log('[GroceryBudget] Plan-to-Instacart complete:', {
        groceryItems: plan.grocery_list.length,
        instacartLink: instacartResult?.link_url ? 'created' : 'failed',
      });

      return res.json({
        ok: true,
        data: {
          plan: {
            id: plan.id,
            days: plan.days,
            weekly_totals: plan.weekly_totals,
            weekly_cost_cents: plan.weekly_cost_cents,
            grocery_list: plan.grocery_list,
          },
          instacart: instacartResult
            ? {
                cart_url: instacartResult.link_url,
                items_count: instacartResult.items_count,
              }
            : null,
          pantry_savings_cents: pantryAdjustment?.cost_reduction_cents || 0,
        },
      });
    } catch (error: any) {
      console.error('[GroceryBudget] Plan-to-Instacart error:', error);
      return res.status(500).json({
        ok: false,
        error: 'Failed to generate meal plan with Instacart cart',
        details: error.message || 'Unknown error',
      });
    }
  });

  // ==========================================================================
  // GET /api/v1/ai/budget-tiers
  // Get available budget tiers
  // ==========================================================================
  router.get('/budget-tiers', async (req: Request, res: Response) => {
    return res.json({
      ok: true,
      data: BUDGET_TIERS.map(tier => ({
        name: tier.name,
        description: tier.description,
        weekly_range: {
          min_cents: tier.weekly_min_cents,
          max_cents: tier.weekly_max_cents,
        },
        daily_range: {
          min_cents: Math.round(tier.weekly_min_cents / 7),
          max_cents: Math.round(tier.weekly_max_cents / 7),
        },
      })),
    });
  });

  // ==========================================================================
  // POST /api/v1/ai/compare-stores
  // Compare prices across stores for a grocery list
  // ==========================================================================
  router.post('/compare-stores', async (req: Request, res: Response) => {
    try {
      const { grocery_list } = req.body;

      if (!grocery_list || !Array.isArray(grocery_list)) {
        return res.status(400).json({
          ok: false,
          error: 'grocery_list array required',
        });
      }

      const comparisons = await groceryOptimizer.compareStores(grocery_list);

      return res.json({
        ok: true,
        data: {
          comparisons,
          recommendation: comparisons[0]?.store,  // Cheapest store
          potential_savings: comparisons[0]?.estimated_savings_vs_avg,
        },
      });
    } catch (error) {
      console.error('[GroceryBudget] Compare stores error:', error);
      return res.status(500).json({
        ok: false,
        error: 'Failed to compare stores',
      });
    }
  });

  // ==========================================================================
  // POST /api/v1/ai/optimize-cart
  // Optimize an existing grocery list for budget
  // ==========================================================================
  router.post('/optimize-cart', async (req: Request, res: Response) => {
    try {
      const { grocery_list, target_budget_cents, preferred_stores } = req.body;

      if (!grocery_list || !Array.isArray(grocery_list)) {
        return res.status(400).json({
          ok: false,
          error: 'grocery_list array required',
        });
      }

      if (!target_budget_cents) {
        return res.status(400).json({
          ok: false,
          error: 'target_budget_cents required',
        });
      }

      const optimization = await groceryOptimizer.optimizeForBudget(
        grocery_list,
        target_budget_cents,
        preferred_stores || ['instacart']
      );

      return res.json({
        ok: true,
        data: optimization,
      });
    } catch (error) {
      console.error('[GroceryBudget] Optimize cart error:', error);
      return res.status(500).json({
        ok: false,
        error: 'Failed to optimize cart',
      });
    }
  });

  // ==========================================================================
  // POST /api/v1/ai/explain-plan
  // Get AI explanation of a meal plan
  // ==========================================================================
  router.post('/explain-plan', async (req: Request, res: Response) => {
    try {
      const { plan, constraints } = req.body;

      if (!plan) {
        return res.status(400).json({
          ok: false,
          error: 'plan required',
        });
      }

      const explanation = await mealPlanService.explainPlanToUser(
        plan,
        constraints || {
          daily_calories: 2000,
          daily_protein_g: 150,
          daily_carbs_g: 200,
          daily_fat_g: 70,
        }
      );

      return res.json({
        ok: true,
        data: { explanation },
      });
    } catch (error) {
      console.error('[GroceryBudget] Explain plan error:', error);
      return res.status(500).json({
        ok: false,
        error: 'Failed to explain plan',
      });
    }
  });

  // ==========================================================================
  // POST /api/v1/ai/adjust-plan
  // Adjust a meal plan based on feedback
  // ==========================================================================
  router.post('/adjust-plan', async (req: Request, res: Response) => {
    try {
      const { plan, feedback } = req.body;

      if (!plan) {
        return res.status(400).json({
          ok: false,
          error: 'plan required',
        });
      }

      if (!feedback) {
        return res.status(400).json({
          ok: false,
          error: 'feedback required',
        });
      }

      const adjustedPlan = await mealPlanService.adjustWeekPlan(plan, feedback);

      return res.json({
        ok: true,
        data: { plan: adjustedPlan },
      });
    } catch (error) {
      console.error('[GroceryBudget] Adjust plan error:', error);
      return res.status(500).json({
        ok: false,
        error: 'Failed to adjust plan',
      });
    }
  });

  // ==========================================================================
  // POST /api/v1/grocery/receipts/upload
  // Upload and parse a grocery receipt (stub for H2)
  // ==========================================================================
  router.post('/receipts/upload', async (req: Request, res: Response) => {
    try {
      const { image_url, image_base64 } = req.body;

      if (!image_url && !image_base64) {
        return res.status(400).json({
          ok: false,
          error: 'image_url or image_base64 required',
        });
      }

      // Parse receipt
      const parsedReceipt = await groceryOptimizer.parseReceipt(image_url || 'data:image/jpeg;base64,' + image_base64);

      return res.json({
        ok: true,
        data: parsedReceipt,
        message: 'Receipt parsing is in beta. Results may need manual verification.',
      });
    } catch (error) {
      console.error('[GroceryBudget] Receipt upload error:', error);
      return res.status(500).json({
        ok: false,
        error: 'Failed to parse receipt',
      });
    }
  });

  return router;
}

export default createGroceryBudgetRouter;
