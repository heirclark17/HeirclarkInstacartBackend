// src/services/groceryOptimizer.ts
// Grocery Budget Optimization Service for Heirclark
// Optimizes meal plans and grocery lists based on budget constraints

import { Pool } from 'pg';
import { NutritionGraphDB } from '../db/nutritionGraph';
import { NutritionFood, StoreFoodMapping } from '../types/nutrition';
import { WeekPlan, GroceryListItem, PlannedMeal } from './mealPlanAI';

// ==========================================================================
// Types
// ==========================================================================

export interface BudgetTier {
  name: 'budget' | 'moderate' | 'premium';
  weekly_min_cents: number;
  weekly_max_cents: number;
  description: string;
}

export const BUDGET_TIERS: BudgetTier[] = [
  { name: 'budget', weekly_min_cents: 5000, weekly_max_cents: 7500, description: '$50-75/week' },
  { name: 'moderate', weekly_min_cents: 7500, weekly_max_cents: 12500, description: '$75-125/week' },
  { name: 'premium', weekly_min_cents: 12500, weekly_max_cents: 20000, description: '$125-200/week' },
];

export interface OptimizationResult {
  original_cost_cents: number;
  optimized_cost_cents: number;
  savings_cents: number;
  savings_percent: number;
  substitutions: Substitution[];
  warnings: string[];
}

export interface Substitution {
  original_item: string;
  replacement_item: string;
  original_price_cents: number;
  replacement_price_cents: number;
  savings_cents: number;
  nutrition_impact: string;  // "similar", "slightly_lower_protein", etc.
}

export interface StoreComparison {
  store: string;
  total_cost_cents: number;
  items_available: number;
  items_missing: string[];
  estimated_savings_vs_avg: number;
}

export interface PantryAdjustment {
  grocery_list: GroceryListItem[];
  items_removed: string[];  // Already in pantry
  cost_reduction_cents: number;
}

// ==========================================================================
// Grocery Optimizer Service
// ==========================================================================

export class GroceryOptimizer {
  private pool: Pool;
  private nutritionDB: NutritionGraphDB;

  constructor(pool: Pool) {
    this.pool = pool;
    this.nutritionDB = new NutritionGraphDB(pool);
  }

  // ==========================================================================
  // Budget Optimization
  // ==========================================================================

  async optimizeForBudget(
    groceryList: GroceryListItem[],
    targetBudgetCents: number,
    stores: string[] = ['instacart']
  ): Promise<OptimizationResult> {
    const originalCost = this.calculateTotalCost(groceryList);
    const substitutions: Substitution[] = [];
    const warnings: string[] = [];

    // If already under budget, return as-is
    if (originalCost <= targetBudgetCents) {
      return {
        original_cost_cents: originalCost,
        optimized_cost_cents: originalCost,
        savings_cents: 0,
        savings_percent: 0,
        substitutions: [],
        warnings: [],
      };
    }

    // Sort items by price (highest first) to find substitution opportunities
    const sortedItems = [...groceryList].sort(
      (a, b) => (b.price_cents || 0) - (a.price_cents || 0)
    );

    let currentCost = originalCost;

    for (const item of sortedItems) {
      if (currentCost <= targetBudgetCents) break;
      if (!item.price_cents || item.price_cents < 200) continue;  // Skip cheap items

      // Find cheaper alternatives
      const alternatives = await this.findCheaperAlternatives(item, stores);

      if (alternatives.length > 0) {
        const best = alternatives[0];
        const savings = (item.price_cents || 0) - best.price_cents;

        substitutions.push({
          original_item: item.name,
          replacement_item: best.name,
          original_price_cents: item.price_cents || 0,
          replacement_price_cents: best.price_cents,
          savings_cents: savings,
          nutrition_impact: best.nutrition_impact,
        });

        currentCost -= savings;
      }
    }

    // Check if we hit target
    if (currentCost > targetBudgetCents) {
      const overage = currentCost - targetBudgetCents;
      warnings.push(
        `Still $${(overage / 100).toFixed(2)} over budget. Consider reducing portion sizes or meal count.`
      );
    }

    return {
      original_cost_cents: originalCost,
      optimized_cost_cents: currentCost,
      savings_cents: originalCost - currentCost,
      savings_percent: Math.round(((originalCost - currentCost) / originalCost) * 100),
      substitutions,
      warnings,
    };
  }

  // ==========================================================================
  // Store Comparison
  // ==========================================================================

  async compareStores(groceryList: GroceryListItem[]): Promise<StoreComparison[]> {
    const stores = ['instacart', 'walmart', 'amazon_fresh', 'kroger'];
    const comparisons: StoreComparison[] = [];

    for (const store of stores) {
      let totalCost = 0;
      let itemsAvailable = 0;
      const itemsMissing: string[] = [];

      for (const item of groceryList) {
        // Try to find item in this store
        const storeItem = await this.findItemInStore(item.name, store);

        if (storeItem) {
          totalCost += storeItem.price_cents || 0;
          itemsAvailable++;
        } else {
          itemsMissing.push(item.name);
        }
      }

      comparisons.push({
        store,
        total_cost_cents: totalCost,
        items_available: itemsAvailable,
        items_missing: itemsMissing,
        estimated_savings_vs_avg: 0,  // Calculated below
      });
    }

    // Calculate savings vs average
    const avgCost = comparisons.reduce((sum, c) => sum + c.total_cost_cents, 0) / comparisons.length;
    for (const c of comparisons) {
      c.estimated_savings_vs_avg = Math.round(avgCost - c.total_cost_cents);
    }

    // Sort by cost
    return comparisons.sort((a, b) => a.total_cost_cents - b.total_cost_cents);
  }

  // ==========================================================================
  // Pantry Integration
  // ==========================================================================

  async adjustForPantry(
    groceryList: GroceryListItem[],
    pantryItems: { name: string; quantity?: number }[]
  ): Promise<PantryAdjustment> {
    const adjustedList: GroceryListItem[] = [];
    const itemsRemoved: string[] = [];
    let costReduction = 0;

    const pantryNames = new Set(pantryItems.map(p => p.name.toLowerCase()));

    for (const item of groceryList) {
      const itemNameLower = item.name.toLowerCase();

      // Check if item (or similar) is in pantry
      const inPantry = pantryNames.has(itemNameLower) ||
        Array.from(pantryNames).some(p =>
          itemNameLower.includes(p) || p.includes(itemNameLower)
        );

      if (inPantry) {
        itemsRemoved.push(item.name);
        costReduction += item.price_cents || 0;
      } else {
        adjustedList.push(item);
      }
    }

    return {
      grocery_list: adjustedList,
      items_removed: itemsRemoved,
      cost_reduction_cents: costReduction,
    };
  }

  // ==========================================================================
  // Smart Substitutions
  // ==========================================================================

  async suggestBudgetSwaps(
    meals: PlannedMeal[],
    budgetTier: 'budget' | 'moderate' | 'premium'
  ): Promise<Array<{ meal: string; swap: string; savings: string; impact: string }>> {
    const suggestions: Array<{ meal: string; swap: string; savings: string; impact: string }> = [];

    // Budget tier swap rules
    const swapRules: Record<string, { budget: string; impact: string }> = {
      'salmon': { budget: 'tilapia or canned salmon', impact: 'Similar protein, less omega-3' },
      'beef tenderloin': { budget: 'chuck roast or ground beef', impact: 'Same protein, different cut' },
      'fresh berries': { budget: 'frozen berries', impact: 'Same nutrition, better value' },
      'quinoa': { budget: 'brown rice', impact: 'Slightly less protein, much cheaper' },
      'almond butter': { budget: 'peanut butter', impact: 'Similar macros, 60% cheaper' },
      'grass-fed beef': { budget: 'regular beef', impact: 'Similar protein, less omega-3' },
      'organic chicken': { budget: 'regular chicken breast', impact: 'Same macros, 40% cheaper' },
      'avocado': { budget: 'olive oil', impact: 'Similar fats, more stable pricing' },
      'shrimp': { budget: 'chicken thighs', impact: 'Similar protein, much cheaper' },
      'greek yogurt': { budget: 'cottage cheese', impact: 'Higher protein, lower cost' },
    };

    if (budgetTier !== 'budget') {
      return suggestions;  // Only suggest swaps for budget tier
    }

    for (const meal of meals) {
      for (const ingredient of meal.ingredients) {
        const nameLower = ingredient.name.toLowerCase();

        for (const [expensive, swap] of Object.entries(swapRules)) {
          if (nameLower.includes(expensive)) {
            suggestions.push({
              meal: meal.name,
              swap: `Replace ${ingredient.name} with ${swap.budget}`,
              savings: '30-50%',
              impact: swap.impact,
            });
          }
        }
      }
    }

    return suggestions;
  }

  // ==========================================================================
  // Instacart Cart Generation
  // ==========================================================================

  async generateInstacartCart(
    groceryList: GroceryListItem[],
    preferredStore?: string
  ): Promise<{
    cart_items: Array<{
      product_id: string;
      quantity: number;
      name: string;
      price_cents: number;
    }>;
    unmapped_items: string[];
    total_cents: number;
  }> {
    const cartItems: Array<{
      product_id: string;
      quantity: number;
      name: string;
      price_cents: number;
    }> = [];
    const unmappedItems: string[] = [];
    let total = 0;

    for (const item of groceryList) {
      if (item.instacart_product_id) {
        // Already mapped
        cartItems.push({
          product_id: item.instacart_product_id,
          quantity: Math.ceil(item.total_amount),  // Round up quantities
          name: item.name,
          price_cents: item.price_cents || 0,
        });
        total += item.price_cents || 0;
      } else {
        // Try to find mapping
        const mapping = await this.findInstacartMapping(item.name, preferredStore);

        if (mapping) {
          cartItems.push({
            product_id: mapping.product_id,
            quantity: Math.ceil(item.total_amount),
            name: mapping.product_name,
            price_cents: mapping.price_cents || 0,
          });
          total += mapping.price_cents || 0;
        } else {
          unmappedItems.push(item.name);
        }
      }
    }

    return {
      cart_items: cartItems,
      unmapped_items: unmappedItems,
      total_cents: total,
    };
  }

  // ==========================================================================
  // Receipt Parsing (Stub for future implementation)
  // ==========================================================================

  async parseReceipt(imageUrl: string): Promise<{
    store: string;
    items: Array<{ name: string; quantity: number; price_cents: number }>;
    total_cents: number;
    date: string;
  }> {
    // This would use OCR (Google Vision, AWS Textract, etc.)
    // For now, return a placeholder
    console.log('[GroceryOptimizer] Receipt parsing not yet implemented');

    return {
      store: 'unknown',
      items: [],
      total_cents: 0,
      date: new Date().toISOString(),
    };
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  private calculateTotalCost(items: GroceryListItem[]): number {
    return items.reduce((sum, item) => sum + (item.price_cents || 0), 0);
  }

  private async findCheaperAlternatives(
    item: GroceryListItem,
    stores: string[]
  ): Promise<Array<{
    name: string;
    price_cents: number;
    nutrition_impact: string;
  }>> {
    const alternatives: Array<{
      name: string;
      price_cents: number;
      nutrition_impact: string;
    }> = [];

    // Search for similar items
    const category = this.inferCategory(item.name);
    const searchResult = await this.nutritionDB.searchFoods({
      category,
      has_store_mapping: true,
    }, 1, 20);

    for (const food of searchResult.foods) {
      for (const mapping of food.store_mappings || []) {
        if (!stores.includes(mapping.store)) continue;
        if (!mapping.price_cents) continue;
        if (mapping.price_cents >= (item.price_cents || 0)) continue;

        // Determine nutrition impact
        let impact = 'similar';
        if (food.nutrients.protein_g < 15) {
          impact = 'lower_protein';
        }

        alternatives.push({
          name: food.name,
          price_cents: mapping.price_cents,
          nutrition_impact: impact,
        });
      }
    }

    // Sort by price
    return alternatives.sort((a, b) => a.price_cents - b.price_cents).slice(0, 3);
  }

  private async findItemInStore(
    itemName: string,
    store: string
  ): Promise<{ name: string; price_cents: number } | null> {
    const searchResult = await this.nutritionDB.searchFoods({
      query: itemName,
      store,
      has_store_mapping: true,
    }, 1, 1);

    if (searchResult.foods.length > 0) {
      const food = searchResult.foods[0];
      const mapping = food.store_mappings?.find(m => m.store === store);
      if (mapping) {
        return {
          name: mapping.product_name,
          price_cents: mapping.price_cents || 0,
        };
      }
    }

    return null;
  }

  private async findInstacartMapping(
    itemName: string,
    preferredStore?: string
  ): Promise<StoreFoodMapping | null> {
    const searchResult = await this.nutritionDB.searchFoods({
      query: itemName,
      store: 'instacart',
      has_store_mapping: true,
    }, 1, 1);

    if (searchResult.foods.length > 0) {
      const food = searchResult.foods[0];
      return food.store_mappings?.find(m => m.store === 'instacart') || null;
    }

    return null;
  }

  private inferCategory(itemName: string): string {
    const nameLower = itemName.toLowerCase();

    if (/chicken|beef|pork|turkey|fish|salmon|tuna|shrimp/.test(nameLower)) {
      return 'protein';
    }
    if (/rice|pasta|bread|oats|quinoa|cereal/.test(nameLower)) {
      return 'grains';
    }
    if (/milk|yogurt|cheese|butter/.test(nameLower)) {
      return 'dairy';
    }
    if (/apple|banana|orange|berry|fruit/.test(nameLower)) {
      return 'fruits';
    }
    if (/broccoli|spinach|carrot|vegetable|salad/.test(nameLower)) {
      return 'vegetables';
    }

    return 'other';
  }
}

export default GroceryOptimizer;
