// src/types/nutrition.ts
// Nutrition Graph Types for Heirclark Platform
// Supports verified food database with quality scores and store mappings

export type VerificationStatus =
  | 'unverified'      // User-submitted, not validated
  | 'scraped'         // Auto-scraped from source
  | 'verified'        // Human or AI verified
  | 'canonical';      // Gold standard, fully validated

export type NutrientSource =
  | 'usda'            // USDA FoodData Central
  | 'branded'         // Brand-provided
  | 'user'            // User-submitted
  | 'scraped'         // Web scraped
  | 'calculated';     // Derived from recipe

export interface NutrientProfile {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g?: number;
  sugar_g?: number;
  sodium_mg?: number;
  cholesterol_mg?: number;
  saturated_fat_g?: number;
  trans_fat_g?: number;
  potassium_mg?: number;
  vitamin_a_iu?: number;
  vitamin_c_mg?: number;
  calcium_mg?: number;
  iron_mg?: number;
}

export interface ServingSize {
  amount: number;
  unit: string;           // 'g', 'oz', 'cup', 'piece', 'serving'
  grams_equivalent: number;
  description?: string;   // "1 medium apple (182g)"
}

export interface NutritionFood {
  id: string;
  name: string;
  brand?: string;
  category?: string;
  subcategory?: string;
  upc?: string;
  canonical_food_id?: string;  // Links variants to canonical food

  // Nutrients per serving
  nutrients: NutrientProfile;
  serving_size: ServingSize;

  // Quality & verification
  verification_status: VerificationStatus;
  quality_score: number;       // 0-100, composite score
  source: NutrientSource;
  source_url?: string;
  source_id?: string;          // USDA FDC ID, etc.

  // Store mappings
  store_mappings?: StoreFoodMapping[];

  // Metadata
  tags?: string[];
  allergens?: string[];
  dietary_flags?: DietaryFlag[];

  created_at: Date;
  updated_at: Date;
  verified_at?: Date;
  verified_by?: string;
}

export type DietaryFlag =
  | 'vegetarian'
  | 'vegan'
  | 'gluten_free'
  | 'dairy_free'
  | 'keto_friendly'
  | 'low_sodium'
  | 'high_protein'
  | 'organic'
  | 'non_gmo';

export interface StoreFoodMapping {
  store: 'instacart' | 'walmart' | 'amazon_fresh' | 'kroger';
  product_id: string;
  product_name: string;
  price_cents?: number;
  price_per_unit?: number;
  unit?: string;
  available: boolean;
  last_checked: Date;
}

// Search & Filter Types
export interface FoodSearchFilters {
  query?: string;
  category?: string;
  brand?: string;
  dietary_flags?: DietaryFlag[];
  min_protein_g?: number;
  max_calories?: number;
  max_carbs_g?: number;
  verification_status?: VerificationStatus[];
  has_store_mapping?: boolean;
  store?: string;
}

export interface FoodSearchResult {
  foods: NutritionFood[];
  total: number;
  page: number;
  page_size: number;
  filters_applied: FoodSearchFilters;
}

// Verification Types
export interface FoodVerificationRequest {
  food_id: string;
  action: 'approve' | 'reject' | 'merge' | 'edit';
  merge_into_id?: string;
  corrections?: Partial<NutrientProfile>;
  verified_by: string;
  notes?: string;
}

export interface FoodVerificationResult {
  food_id: string;
  previous_status: VerificationStatus;
  new_status: VerificationStatus;
  quality_score: number;
  verified_at: Date;
}

// Recipe/Composite Food Types
export interface RecipeIngredient {
  food_id: string;
  food_name: string;
  amount: number;
  unit: string;
  grams: number;
  nutrients: NutrientProfile;
}

export interface CompositeFood extends NutritionFood {
  type: 'recipe';
  ingredients: RecipeIngredient[];
  servings: number;
  prep_time_minutes?: number;
  cook_time_minutes?: number;
  instructions?: string[];
}

// Cart-to-Plan Types
export interface CartItem {
  product_id: string;
  product_name: string;
  quantity: number;
  unit?: string;
  price_cents: number;
  nutrition_food_id?: string;  // Mapped to our nutrition graph
}

export interface CartAnalysis {
  cart_items: CartItem[];
  total_cost_cents: number;

  // Nutritional totals for entire cart
  total_nutrients: NutrientProfile;

  // Per-day estimates (assuming cart lasts X days)
  estimated_days: number;
  daily_nutrients: NutrientProfile;

  // Gaps and suggestions
  protein_gap_g?: number;
  suggested_additions?: NutritionFood[];

  // Meal plan compatibility
  can_support_plan: boolean;
  missing_for_plan?: string[];
}

// Quality Scoring Components
export interface QualityScoreBreakdown {
  source_quality: number;      // 0-25: USDA=25, branded=20, scraped=10, user=5
  completeness: number;        // 0-25: % of nutrient fields filled
  verification: number;        // 0-25: unverified=0, scraped=10, verified=20, canonical=25
  freshness: number;           // 0-25: days since last update
  total: number;               // Sum of above
}

// API Response Types
export interface NutritionApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
  meta?: {
    request_id: string;
    processing_time_ms: number;
  };
}
