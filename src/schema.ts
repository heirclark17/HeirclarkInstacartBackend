import { z } from "zod";

export const IngredientSchema = z.object({
  name: z.string().min(1, "name required"),
  quantity: z.number().nonnegative(),
  unit: z.string().min(1, "unit required"),
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

export const BuildListPayloadSchema = z.object({
  // whatever else you want from the client:
  start: z.string().optional(), // e.g. date string
  plan: z.string().optional(),  // e.g. "7-day", etc.
  recipeLandingUrl: z.string().url().optional(),

  // *** IMPORTANT: top-level object with items array ***
  items: z.array(IngredientSchema).min(1, "items cannot be empty")
});

export type BuildListPayload = z.infer<typeof BuildListPayloadSchema>;
