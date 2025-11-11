import { z } from "zod";

/**
 * A single ingredient line from a recipe
 */
export const IngredientSchema = z.object({
  name: z.string().min(1, "name is required"),
  quantity: z.number().nonnegative().optional(), // allow missing if you're only searching by name
  unit: z.string().trim().optional(),            // e.g., "lb", "tbsp"
  prep: z.string().trim().optional(),            // e.g., "minced", "diced"
  notes: z.string().trim().optional(),
  category: z.string().trim().optional(),        // e.g., "meat", "oil"
  brand: z.string().trim().nullable().optional(),
  size_preference: z.string().trim().optional(), // e.g., "1-1.5 lb pack"
  pantry: z.boolean().optional().default(false),
  substitutions_allowed: z.boolean().optional().default(true),
  retailer_map: z
    .object({
      instacart_query: z.string().trim().optional(),
      upc: z.string().trim().optional().nullable(),
      store_sku: z.string().trim().optional().nullable()
    })
    .partial()
    .optional()
});

export type Ingredient = z.infer<typeof IngredientSchema>;

export const IngredientListSchema = z.array(IngredientSchema).min(1, "At least one ingredient is required");

export const BuildListRequestSchema = z.object({
  start: z.string().datetime().optional(), // ISO string if you need scheduling
  recipeLandingUrl: z.string().url().optional(),
  plan: z
    .object({
      title: z.string().optional(),
      ingredients: IngredientListSchema
    })
    .strict()
});
export type BuildListRequest = z.infer<typeof BuildListRequestSchema>;
