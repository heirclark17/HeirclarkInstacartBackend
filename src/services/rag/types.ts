/**
 * RAG System Types
 * Types for the Retrieval-Augmented Generation system
 */

import { z } from 'zod';

// ============================================================================
// Document Types
// ============================================================================

export type DocumentType =
  | 'rules'
  | 'food'
  | 'support'
  | 'portion'
  | 'conversion'
  | 'general'
  | 'portion_rules'
  | 'macro_data'
  | 'cooking_methods'
  | 'swap_suggestions'
  | 'confidence_rubric';

export type DocumentSource =
  | 'seed'
  | 'usda'
  | 'user_feedback'
  | 'nutritionist'
  | 'api'
  | 'heirclark_nutrition_rules';

export interface RagDocument {
  id: string;
  title: string;
  source: DocumentSource;
  docType: DocumentType;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface RagChunk {
  id: string;
  documentId: string;
  chunkIndex: number;
  chunkText: string;
  chunkMetadata: Record<string, unknown>;
  embedding?: number[];
  tokens?: number;
  createdAt: Date;
}

export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  chunkText: string;
  chunkMetadata: Record<string, unknown>;
  docTitle: string;
  docType: DocumentType;
  similarity: number;
}

// ============================================================================
// AI Request/Response Types
// ============================================================================

export interface AiRequestLog {
  id: string;
  shopifyCustomerId?: string;
  mode: 'meal_text' | 'meal_photo' | 'barcode';
  queryText?: string;
  imageHash?: string;
  retrievedChunkIds: string[];
  llmModel: string;
  llmResponse?: Record<string, unknown>;
  confidence?: number;
  processingTimeMs?: number;
  createdAt: Date;
}

// ============================================================================
// Macro Value Schema (exact or ranged)
// ============================================================================

export const MacroValueSchema = z.object({
  value: z.number().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
}).refine(
  (data) => data.value !== undefined || (data.min !== undefined && data.max !== undefined),
  { message: 'Must have either value or min/max range' }
);

export type MacroValue = z.infer<typeof MacroValueSchema>;

// ============================================================================
// Healthier Swap Schema
// ============================================================================

export const HealthierSwapSchema = z.object({
  swap: z.string().min(1),
  reason: z.string().min(1),
  estimated_macro_impact: z.string().optional(),
  calories_diff: z.number().optional(),
  protein_diff: z.number().optional(),
  carbs_diff: z.number().optional(),
  fat_diff: z.number().optional(),
});

export type HealthierSwap = z.infer<typeof HealthierSwapSchema>;

// ============================================================================
// Food Item Schema (detected in photo/text)
// ============================================================================

export const FoodItemSchema = z.object({
  name: z.string().min(1),
  portion: z.string().optional(),
  portion_grams: z.number().optional(),
  calories: z.number().min(0),
  protein: z.number().min(0),
  carbs: z.number().min(0),
  fat: z.number().min(0),
  notes: z.string().optional(),
  confidence: z.number().min(0).max(100).optional(),
});

export type FoodItem = z.infer<typeof FoodItemSchema>;

// ============================================================================
// Full AI Meal Estimate Schema (RAG-enhanced)
// ============================================================================

export const AiMealEstimateSchema = z.object({
  meal_name: z.string().min(1),
  meal_time_of_day: z.enum(['breakfast', 'lunch', 'dinner', 'snack', 'unknown']),
  what_i_see_on_the_plate: z.string().optional(),

  // Macros can be exact or ranged
  macros: z.object({
    calories: MacroValueSchema,
    protein_g: MacroValueSchema,
    carbs_g: MacroValueSchema,
    fats_g: MacroValueSchema,
  }),

  // Individual food items detected
  foods: z.array(FoodItemSchema).optional(),

  // Confidence 0-100
  confidence: z.number().min(0).max(100),

  // RAG-enhanced explanation
  explanation: z.string().min(1),
  explanation_sources: z.array(z.string()).optional(), // chunk IDs

  // Healthier alternatives
  healthier_swaps: z.array(HealthierSwapSchema).optional(),

  // Follow-up question if low confidence
  follow_up_question: z.string().optional(),

  // Portion estimation notes
  portion_notes: z.string().optional(),
});

export type AiMealEstimate = z.infer<typeof AiMealEstimateSchema>;

// ============================================================================
// RAG Retrieval Options
// ============================================================================

export interface RetrievalOptions {
  query: string;
  k?: number; // default 8
  filters?: {
    types?: DocumentType[];
    tags?: string[];
    brand?: string;
  };
  similarityThreshold?: number; // default 0.5
}

export interface ChunkingOptions {
  chunkSize?: number; // default 500 tokens
  overlap?: number; // default 50 tokens
  separator?: string; // default '\n\n'
}

export interface UpsertDocumentOptions {
  title: string;
  source: DocumentSource;
  docType: DocumentType;
  text: string;
  metadata?: Record<string, unknown>;
  chunkingOptions?: ChunkingOptions;
}

// ============================================================================
// Top Foods Types
// ============================================================================

export interface TopFood {
  name: string;
  count: number;
  avgCalories?: number;
  avgProtein?: number;
  avgCarbs?: number;
  avgFat?: number;
}

export interface TopFoodsResult {
  foods: TopFood[];
  source: 'database' | 'fallback';
  lastUpdated?: Date;
}

// ============================================================================
// Legacy Response Compatibility
// ============================================================================

/**
 * Convert RAG-enhanced response to legacy format for backward compatibility
 */
export function toLegacyFormat(estimate: AiMealEstimate): Record<string, unknown> {
  const getMacroValue = (m: MacroValue): number => {
    if (m.value !== undefined) return m.value;
    if (m.min !== undefined && m.max !== undefined) return Math.round((m.min + m.max) / 2);
    return 0;
  };

  return {
    ok: true,
    mealName: estimate.meal_name,
    name: estimate.meal_name, // backward compat
    label: estimate.meal_time_of_day,
    calories: getMacroValue(estimate.macros.calories),
    protein: getMacroValue(estimate.macros.protein_g),
    carbs: getMacroValue(estimate.macros.carbs_g),
    fat: getMacroValue(estimate.macros.fats_g),
    macros: {
      calories: getMacroValue(estimate.macros.calories),
      protein: getMacroValue(estimate.macros.protein_g),
      carbs: getMacroValue(estimate.macros.carbs_g),
      fat: getMacroValue(estimate.macros.fats_g),
    },
    foods: estimate.foods?.map(f => ({
      name: f.name,
      portion: f.portion,
      calories: f.calories,
      protein: f.protein,
      carbs: f.carbs,
      fat: f.fat,
      notes: f.notes,
    })) || [],
    healthierSwaps: estimate.healthier_swaps?.map(s => ({
      swap: s.swap,
      why: s.reason,
      reason: s.reason,
      estimated_macro_impact: s.estimated_macro_impact,
    })) || [],
    swaps: estimate.healthier_swaps?.map(s => ({
      swap: s.swap,
      why: s.reason,
    })) || [],
    confidence: estimate.confidence / 100, // normalize to 0-1 for frontend
    explanation: estimate.explanation,
    explanation_sources: estimate.explanation_sources || [],
    portionNotes: estimate.portion_notes || '',
    follow_up_question: estimate.follow_up_question,
    // Include full RAG response for debugging
    _rag: {
      macros_ranged: estimate.macros,
      what_i_see: estimate.what_i_see_on_the_plate,
    },
  };
}
