// src/db/nutritionGraph.ts
// Nutrition Graph Database Schema and Queries
// PostgreSQL with pg_trgm for fuzzy text search

import { Pool } from 'pg';
import {
  NutritionFood,
  FoodSearchFilters,
  FoodSearchResult,
  FoodVerificationRequest,
  FoodVerificationResult,
  StoreFoodMapping,
  QualityScoreBreakdown,
  VerificationStatus,
} from '../types/nutrition';

// ============================================================================
// SQL MIGRATIONS
// ============================================================================

export const NUTRITION_GRAPH_MIGRATIONS = `
-- Enable trigram extension for fuzzy search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================================
-- Core Foods Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS nutrition_foods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  name_normalized TEXT GENERATED ALWAYS AS (lower(trim(name))) STORED,
  brand TEXT,
  category TEXT,
  subcategory TEXT,
  upc TEXT UNIQUE,
  canonical_food_id UUID REFERENCES nutrition_foods(id),

  -- Nutrients per serving
  calories NUMERIC NOT NULL DEFAULT 0,
  protein_g NUMERIC NOT NULL DEFAULT 0,
  carbs_g NUMERIC NOT NULL DEFAULT 0,
  fat_g NUMERIC NOT NULL DEFAULT 0,
  fiber_g NUMERIC,
  sugar_g NUMERIC,
  sodium_mg NUMERIC,
  cholesterol_mg NUMERIC,
  saturated_fat_g NUMERIC,
  trans_fat_g NUMERIC,
  potassium_mg NUMERIC,
  vitamin_a_iu NUMERIC,
  vitamin_c_mg NUMERIC,
  calcium_mg NUMERIC,
  iron_mg NUMERIC,

  -- Serving size
  serving_amount NUMERIC NOT NULL DEFAULT 1,
  serving_unit TEXT NOT NULL DEFAULT 'serving',
  serving_grams NUMERIC NOT NULL DEFAULT 100,
  serving_description TEXT,

  -- Quality & verification
  verification_status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (verification_status IN ('unverified', 'scraped', 'verified', 'canonical')),
  quality_score INTEGER NOT NULL DEFAULT 0 CHECK (quality_score >= 0 AND quality_score <= 100),
  source TEXT NOT NULL DEFAULT 'user'
    CHECK (source IN ('usda', 'branded', 'user', 'scraped', 'calculated')),
  source_url TEXT,
  source_id TEXT,

  -- Arrays stored as JSONB
  tags JSONB DEFAULT '[]'::jsonb,
  allergens JSONB DEFAULT '[]'::jsonb,
  dietary_flags JSONB DEFAULT '[]'::jsonb,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verified_at TIMESTAMPTZ,
  verified_by TEXT
);

-- Indexes for search performance
CREATE INDEX IF NOT EXISTS idx_nutrition_foods_name_trgm
  ON nutrition_foods USING GIN (name_normalized gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_nutrition_foods_brand
  ON nutrition_foods (lower(brand)) WHERE brand IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_nutrition_foods_category
  ON nutrition_foods (category) WHERE category IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_nutrition_foods_upc
  ON nutrition_foods (upc) WHERE upc IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_nutrition_foods_verification
  ON nutrition_foods (verification_status);
CREATE INDEX IF NOT EXISTS idx_nutrition_foods_quality
  ON nutrition_foods (quality_score DESC);
CREATE INDEX IF NOT EXISTS idx_nutrition_foods_canonical
  ON nutrition_foods (canonical_food_id) WHERE canonical_food_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_nutrition_foods_dietary
  ON nutrition_foods USING GIN (dietary_flags);

-- ============================================================================
-- Store Mappings Table (Instacart, Walmart, etc.)
-- ============================================================================
CREATE TABLE IF NOT EXISTS nutrition_store_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  food_id UUID NOT NULL REFERENCES nutrition_foods(id) ON DELETE CASCADE,
  store TEXT NOT NULL CHECK (store IN ('instacart', 'walmart', 'amazon_fresh', 'kroger')),
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  price_cents INTEGER,
  price_per_unit NUMERIC,
  unit TEXT,
  available BOOLEAN NOT NULL DEFAULT true,
  last_checked TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (food_id, store, product_id)
);

CREATE INDEX IF NOT EXISTS idx_store_mappings_food
  ON nutrition_store_mappings (food_id);
CREATE INDEX IF NOT EXISTS idx_store_mappings_store_product
  ON nutrition_store_mappings (store, product_id);
CREATE INDEX IF NOT EXISTS idx_store_mappings_available
  ON nutrition_store_mappings (store, available) WHERE available = true;

-- ============================================================================
-- Verification Audit Log
-- ============================================================================
CREATE TABLE IF NOT EXISTS nutrition_verification_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  food_id UUID NOT NULL REFERENCES nutrition_foods(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('approve', 'reject', 'merge', 'edit', 'create')),
  previous_status TEXT,
  new_status TEXT,
  previous_quality_score INTEGER,
  new_quality_score INTEGER,
  merge_into_id UUID REFERENCES nutrition_foods(id),
  corrections JSONB,
  verified_by TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_verification_log_food
  ON nutrition_verification_log (food_id);
CREATE INDEX IF NOT EXISTS idx_verification_log_time
  ON nutrition_verification_log (created_at DESC);

-- ============================================================================
-- Recipe Ingredients (for composite foods)
-- ============================================================================
CREATE TABLE IF NOT EXISTS nutrition_recipe_ingredients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id UUID NOT NULL REFERENCES nutrition_foods(id) ON DELETE CASCADE,
  ingredient_food_id UUID NOT NULL REFERENCES nutrition_foods(id) ON DELETE RESTRICT,
  amount NUMERIC NOT NULL,
  unit TEXT NOT NULL,
  grams NUMERIC NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recipe_ingredients_recipe
  ON nutrition_recipe_ingredients (recipe_id);

-- ============================================================================
-- Updated timestamp trigger
-- ============================================================================
CREATE OR REPLACE FUNCTION update_nutrition_foods_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_nutrition_foods_updated_at ON nutrition_foods;
CREATE TRIGGER trigger_nutrition_foods_updated_at
  BEFORE UPDATE ON nutrition_foods
  FOR EACH ROW
  EXECUTE FUNCTION update_nutrition_foods_updated_at();
`;

// ============================================================================
// Database Connection (assumes pool is passed in)
// ============================================================================

export class NutritionGraphDB {
  constructor(private pool: Pool) {}

  // --------------------------------------------------------------------------
  // Initialize schema
  // --------------------------------------------------------------------------
  async initializeSchema(): Promise<void> {
    await this.pool.query(NUTRITION_GRAPH_MIGRATIONS);
    console.log('[NutritionGraph] Schema initialized');
  }

  // --------------------------------------------------------------------------
  // Search Foods
  // --------------------------------------------------------------------------
  async searchFoods(
    filters: FoodSearchFilters,
    page: number = 1,
    pageSize: number = 20
  ): Promise<FoodSearchResult> {
    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    // Text search with ILIKE (simple but reliable)
    if (filters.query && filters.query.trim()) {
      conditions.push(`(
        name ILIKE $${paramIndex}
        OR brand ILIKE $${paramIndex}
      )`);
      params.push(`%${filters.query}%`);
      paramIndex++;
    }

    // Category filter
    if (filters.category) {
      conditions.push(`category = $${paramIndex}`);
      params.push(filters.category);
      paramIndex++;
    }

    // Brand filter
    if (filters.brand) {
      conditions.push(`lower(brand) = $${paramIndex}`);
      params.push(filters.brand.toLowerCase());
      paramIndex++;
    }

    // Dietary flags filter (JSONB contains)
    if (filters.dietary_flags && filters.dietary_flags.length > 0) {
      conditions.push(`dietary_flags ?& $${paramIndex}`);
      params.push(filters.dietary_flags);
      paramIndex++;
    }

    // Nutrient filters
    if (filters.min_protein_g !== undefined) {
      conditions.push(`protein_g >= $${paramIndex}`);
      params.push(filters.min_protein_g);
      paramIndex++;
    }

    if (filters.max_calories !== undefined) {
      conditions.push(`calories <= $${paramIndex}`);
      params.push(filters.max_calories);
      paramIndex++;
    }

    if (filters.max_carbs_g !== undefined) {
      conditions.push(`carbs_g <= $${paramIndex}`);
      params.push(filters.max_carbs_g);
      paramIndex++;
    }

    // Verification status filter
    if (filters.verification_status && filters.verification_status.length > 0) {
      conditions.push(`verification_status = ANY($${paramIndex})`);
      params.push(filters.verification_status);
      paramIndex++;
    }

    // Has store mapping filter
    if (filters.has_store_mapping) {
      conditions.push(`EXISTS (
        SELECT 1 FROM nutrition_store_mappings sm
        WHERE sm.food_id = nutrition_foods.id
        ${filters.store ? `AND sm.store = $${paramIndex}` : ''}
        AND sm.available = true
      )`);
      if (filters.store) {
        params.push(filters.store);
        paramIndex++;
      }
    }

    const whereClause = conditions.length > 0
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    // Count query
    const countResult = await this.pool.query(
      `SELECT COUNT(*) FROM nutrition_foods ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count, 10);

    // Determine sort order
    const orderBy = 'quality_score DESC, name ASC';

    // Main query with pagination
    const offset = (page - 1) * pageSize;
    const foodsResult = await this.pool.query(
      `SELECT * FROM nutrition_foods
       ${whereClause}
       ORDER BY ${orderBy}
       LIMIT ${pageSize} OFFSET ${offset}`,
      params
    );

    const foods = foodsResult.rows.map(this.rowToFood);

    return {
      foods,
      total,
      page,
      page_size: pageSize,
      filters_applied: filters,
    };
  }

  // --------------------------------------------------------------------------
  // Get Food by ID
  // --------------------------------------------------------------------------
  async getFoodById(id: string): Promise<NutritionFood | null> {
    const result = await this.pool.query(
      `SELECT f.*,
        (SELECT json_agg(sm.*) FROM nutrition_store_mappings sm WHERE sm.food_id = f.id) as store_mappings
       FROM nutrition_foods f
       WHERE f.id = $1`,
      [id]
    );

    if (result.rowCount === 0) return null;
    return this.rowToFood(result.rows[0]);
  }

  // --------------------------------------------------------------------------
  // Get Food by UPC
  // --------------------------------------------------------------------------
  async getFoodByUpc(upc: string): Promise<NutritionFood | null> {
    const result = await this.pool.query(
      `SELECT * FROM nutrition_foods WHERE upc = $1`,
      [upc]
    );

    if (result.rowCount === 0) return null;
    return this.rowToFood(result.rows[0]);
  }

  // --------------------------------------------------------------------------
  // Create Food
  // --------------------------------------------------------------------------
  async createFood(food: Partial<NutritionFood>): Promise<NutritionFood> {
    const qualityScore = this.calculateQualityScore(food);

    const result = await this.pool.query(
      `INSERT INTO nutrition_foods (
        name, brand, category, subcategory, upc, canonical_food_id,
        calories, protein_g, carbs_g, fat_g, fiber_g, sugar_g,
        sodium_mg, cholesterol_mg, saturated_fat_g, trans_fat_g,
        potassium_mg, vitamin_a_iu, vitamin_c_mg, calcium_mg, iron_mg,
        serving_amount, serving_unit, serving_grams, serving_description,
        verification_status, quality_score, source, source_url, source_id,
        tags, allergens, dietary_flags
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11, $12,
        $13, $14, $15, $16,
        $17, $18, $19, $20, $21,
        $22, $23, $24, $25,
        $26, $27, $28, $29, $30,
        $31, $32, $33
      ) RETURNING *`,
      [
        food.name,
        food.brand,
        food.category,
        food.subcategory,
        food.upc,
        food.canonical_food_id,
        food.nutrients?.calories || 0,
        food.nutrients?.protein_g || 0,
        food.nutrients?.carbs_g || 0,
        food.nutrients?.fat_g || 0,
        food.nutrients?.fiber_g,
        food.nutrients?.sugar_g,
        food.nutrients?.sodium_mg,
        food.nutrients?.cholesterol_mg,
        food.nutrients?.saturated_fat_g,
        food.nutrients?.trans_fat_g,
        food.nutrients?.potassium_mg,
        food.nutrients?.vitamin_a_iu,
        food.nutrients?.vitamin_c_mg,
        food.nutrients?.calcium_mg,
        food.nutrients?.iron_mg,
        food.serving_size?.amount || 1,
        food.serving_size?.unit || 'serving',
        food.serving_size?.grams_equivalent || 100,
        food.serving_size?.description,
        food.verification_status || 'unverified',
        qualityScore,
        food.source || 'user',
        food.source_url,
        food.source_id,
        JSON.stringify(food.tags || []),
        JSON.stringify(food.allergens || []),
        JSON.stringify(food.dietary_flags || []),
      ]
    );

    return this.rowToFood(result.rows[0]);
  }

  // --------------------------------------------------------------------------
  // Verify Food
  // --------------------------------------------------------------------------
  async verifyFood(request: FoodVerificationRequest): Promise<FoodVerificationResult> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      // Get current state
      const current = await client.query(
        'SELECT * FROM nutrition_foods WHERE id = $1 FOR UPDATE',
        [request.food_id]
      );

      if (current.rowCount === 0) {
        throw new Error('Food not found');
      }

      const food = current.rows[0];
      let newStatus: VerificationStatus = food.verification_status;
      let newQualityScore = food.quality_score;

      switch (request.action) {
        case 'approve':
          newStatus = 'verified';
          newQualityScore = Math.min(100, food.quality_score + 25);
          break;

        case 'reject':
          newStatus = 'unverified';
          newQualityScore = Math.max(0, food.quality_score - 20);
          break;

        case 'merge':
          if (!request.merge_into_id) {
            throw new Error('merge_into_id required for merge action');
          }
          // Update canonical reference and mark as merged
          await client.query(
            `UPDATE nutrition_foods
             SET canonical_food_id = $1, verification_status = 'unverified'
             WHERE id = $2`,
            [request.merge_into_id, request.food_id]
          );
          break;

        case 'edit':
          if (request.corrections) {
            const updates: string[] = [];
            const values: any[] = [];
            let idx = 1;

            for (const [key, value] of Object.entries(request.corrections)) {
              updates.push(`${key} = $${idx}`);
              values.push(value);
              idx++;
            }

            if (updates.length > 0) {
              values.push(request.food_id);
              await client.query(
                `UPDATE nutrition_foods SET ${updates.join(', ')} WHERE id = $${idx}`,
                values
              );
            }
          }
          newStatus = 'verified';
          break;
      }

      // Update the food record
      await client.query(
        `UPDATE nutrition_foods
         SET verification_status = $1, quality_score = $2, verified_at = NOW(), verified_by = $3
         WHERE id = $4`,
        [newStatus, newQualityScore, request.verified_by, request.food_id]
      );

      // Log the verification action
      await client.query(
        `INSERT INTO nutrition_verification_log
         (food_id, action, previous_status, new_status, previous_quality_score, new_quality_score,
          merge_into_id, corrections, verified_by, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          request.food_id,
          request.action,
          food.verification_status,
          newStatus,
          food.quality_score,
          newQualityScore,
          request.merge_into_id,
          request.corrections ? JSON.stringify(request.corrections) : null,
          request.verified_by,
          request.notes,
        ]
      );

      await client.query('COMMIT');

      return {
        food_id: request.food_id,
        previous_status: food.verification_status,
        new_status: newStatus,
        quality_score: newQualityScore,
        verified_at: new Date(),
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // --------------------------------------------------------------------------
  // Add Store Mapping
  // --------------------------------------------------------------------------
  async addStoreMapping(foodId: string, mapping: Omit<StoreFoodMapping, 'last_checked'>): Promise<void> {
    await this.pool.query(
      `INSERT INTO nutrition_store_mappings
       (food_id, store, product_id, product_name, price_cents, price_per_unit, unit, available)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (food_id, store, product_id)
       DO UPDATE SET
         product_name = EXCLUDED.product_name,
         price_cents = EXCLUDED.price_cents,
         price_per_unit = EXCLUDED.price_per_unit,
         unit = EXCLUDED.unit,
         available = EXCLUDED.available,
         last_checked = NOW()`,
      [
        foodId,
        mapping.store,
        mapping.product_id,
        mapping.product_name,
        mapping.price_cents,
        mapping.price_per_unit,
        mapping.unit,
        mapping.available,
      ]
    );
  }

  // --------------------------------------------------------------------------
  // Get Foods with Store Availability
  // --------------------------------------------------------------------------
  async getFoodsWithStoreAvailability(
    foodIds: string[],
    store: string
  ): Promise<Map<string, StoreFoodMapping>> {
    const result = await this.pool.query(
      `SELECT * FROM nutrition_store_mappings
       WHERE food_id = ANY($1) AND store = $2 AND available = true`,
      [foodIds, store]
    );

    const mappings = new Map<string, StoreFoodMapping>();
    for (const row of result.rows) {
      mappings.set(row.food_id, {
        store: row.store,
        product_id: row.product_id,
        product_name: row.product_name,
        price_cents: row.price_cents,
        price_per_unit: row.price_per_unit,
        unit: row.unit,
        available: row.available,
        last_checked: row.last_checked,
      });
    }

    return mappings;
  }

  // --------------------------------------------------------------------------
  // Calculate Quality Score
  // --------------------------------------------------------------------------
  private calculateQualityScore(food: Partial<NutritionFood>): number {
    let score = 0;

    // Source quality (0-25)
    const sourceScores: Record<string, number> = {
      usda: 25,
      branded: 20,
      scraped: 10,
      calculated: 15,
      user: 5,
    };
    score += sourceScores[food.source || 'user'] || 5;

    // Completeness (0-25)
    const nutrients = food.nutrients || {};
    const completenessFields = [
      'calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g',
      'sugar_g', 'sodium_mg', 'saturated_fat_g'
    ];
    const filledFields = completenessFields.filter(
      f => (nutrients as any)[f] !== undefined && (nutrients as any)[f] !== null
    ).length;
    score += Math.round((filledFields / completenessFields.length) * 25);

    // Verification (0-25)
    const verificationScores: Record<string, number> = {
      canonical: 25,
      verified: 20,
      scraped: 10,
      unverified: 0,
    };
    score += verificationScores[food.verification_status || 'unverified'] || 0;

    // Freshness bonus (0-25) - new foods get full freshness
    score += 25;

    return Math.min(100, score);
  }

  // --------------------------------------------------------------------------
  // Row to Food Object Mapper
  // --------------------------------------------------------------------------
  private rowToFood(row: any): NutritionFood {
    return {
      id: row.id,
      name: row.name,
      brand: row.brand,
      category: row.category,
      subcategory: row.subcategory,
      upc: row.upc,
      canonical_food_id: row.canonical_food_id,
      nutrients: {
        calories: parseFloat(row.calories) || 0,
        protein_g: parseFloat(row.protein_g) || 0,
        carbs_g: parseFloat(row.carbs_g) || 0,
        fat_g: parseFloat(row.fat_g) || 0,
        fiber_g: row.fiber_g ? parseFloat(row.fiber_g) : undefined,
        sugar_g: row.sugar_g ? parseFloat(row.sugar_g) : undefined,
        sodium_mg: row.sodium_mg ? parseFloat(row.sodium_mg) : undefined,
        cholesterol_mg: row.cholesterol_mg ? parseFloat(row.cholesterol_mg) : undefined,
        saturated_fat_g: row.saturated_fat_g ? parseFloat(row.saturated_fat_g) : undefined,
        trans_fat_g: row.trans_fat_g ? parseFloat(row.trans_fat_g) : undefined,
        potassium_mg: row.potassium_mg ? parseFloat(row.potassium_mg) : undefined,
        vitamin_a_iu: row.vitamin_a_iu ? parseFloat(row.vitamin_a_iu) : undefined,
        vitamin_c_mg: row.vitamin_c_mg ? parseFloat(row.vitamin_c_mg) : undefined,
        calcium_mg: row.calcium_mg ? parseFloat(row.calcium_mg) : undefined,
        iron_mg: row.iron_mg ? parseFloat(row.iron_mg) : undefined,
      },
      serving_size: {
        amount: parseFloat(row.serving_amount) || 1,
        unit: row.serving_unit || 'serving',
        grams_equivalent: parseFloat(row.serving_grams) || 100,
        description: row.serving_description,
      },
      verification_status: row.verification_status,
      quality_score: row.quality_score,
      source: row.source,
      source_url: row.source_url,
      source_id: row.source_id,
      store_mappings: row.store_mappings || [],
      tags: row.tags || [],
      allergens: row.allergens || [],
      dietary_flags: row.dietary_flags || [],
      created_at: row.created_at,
      updated_at: row.updated_at,
      verified_at: row.verified_at,
      verified_by: row.verified_by,
    };
  }
}

export default NutritionGraphDB;
