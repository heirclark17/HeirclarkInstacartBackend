import { z } from "zod";

export const IngredientSchema = z.object({
  name: z.string().min(1, "Ingredient name required"),
  quantity: z.number().nonnegative(),
  unit: z.string().min(1, "Unit required"),
  category: z.string().default("other"),
  pantry: z.boolean().default(false),

  // optional
  prep: z.string().optional().default(""),
  notes: z.string().optional().default(""),
  brand: z.string().nullable().optional(),
  size_preference: z.string().optional(),
  substitutions_allowed: z.boolean().optional().default(true),

  retailer_map: z
    .object({
      instacart_query: z.string().optional(),
      upc: z.string().nullable().optional(),
      store_sku: z.string().nullable().optional()
    })
    .partial()
    .optional()
});

/**
 * This now matches your *backend expectation*:
 * - `plan` is an array of ingredients,
 * - not a string.
 */
export const BuildListPayloadSchema = z.object({
  start: z.string().optional(),
  recipeLandingUrl: z.string().url().optional(),

  /**
   * plan = array of ingredients
   */
  plan: z.array(IngredientSchema).min(1, "plan must contain at least 1 ingredient"),

  // (optional: you can support items[] too if needed)
  items: z.array(IngredientSchema).optional()
});

export type BuildListPayload = z.infer<typeof BuildListPayloadSchema>;
