/**
 * RAG Seed Script
 * Seeds the RAG system with initial documents for meal estimation
 *
 * Run with: npx ts-node scripts/rag-seed.ts
 */

import 'dotenv/config';
import { pool } from '../src/db/pool';
import { upsertDocumentWithChunks, checkRagHealth, DocumentType, DocumentSource } from '../src/services/rag';

// ============================================================================
// Seed Documents
// ============================================================================

interface SeedDocument {
  title: string;
  source: DocumentSource;
  docType: DocumentType;
  text: string;
  metadata?: Record<string, unknown>;
}

const SEED_DOCUMENTS: SeedDocument[] = [
  // ============================================================================
  // Portion Assumption Rules
  // ============================================================================
  {
    title: 'Default Portion Assumptions',
    source: 'heirclark_nutrition_rules',
    docType: 'portion_rules',
    text: `# Default Portion Assumptions

When users don't specify portions, use these standard assumptions:

## Proteins (Cooked Weight)
- Chicken breast: 6 oz (170g) = 280 cal, 52g protein, 0g carbs, 6g fat
- Ground turkey 93/7: 4 oz (113g) = 170 cal, 21g protein, 0g carbs, 9g fat
- Salmon fillet: 6 oz (170g) = 350 cal, 40g protein, 0g carbs, 20g fat
- Steak (lean): 6 oz (170g) = 310 cal, 42g protein, 0g carbs, 14g fat
- Shrimp: 6 oz (170g) = 180 cal, 36g protein, 0g carbs, 2g fat
- Eggs: 2 large = 156 cal, 12g protein, 1g carbs, 10g fat
- Egg whites: 4 large = 68 cal, 14g protein, 1g carbs, 0g fat
- Greek yogurt: 1 cup (245g) = 130 cal, 23g protein, 8g carbs, 0g fat
- Cottage cheese: 1 cup (226g) = 206 cal, 28g protein, 6g carbs, 5g fat
- Tofu (firm): 1/2 block (200g) = 175 cal, 20g protein, 4g carbs, 10g fat

## Carbohydrates (Cooked Weight)
- Rice (white or brown): 1 cup (195g) = 215 cal, 5g protein, 45g carbs, 2g fat
- Quinoa: 1 cup (185g) = 222 cal, 8g protein, 39g carbs, 4g fat
- Sweet potato: 1 medium (150g) = 103 cal, 2g protein, 24g carbs, 0g fat
- Oatmeal: 1 cup cooked (234g) = 158 cal, 6g protein, 27g carbs, 3g fat
- Pasta: 1 cup cooked (140g) = 220 cal, 8g protein, 43g carbs, 1g fat
- Bread (slice): 1 slice (30g) = 80 cal, 3g protein, 15g carbs, 1g fat
- Mission zero carb tortilla: 1 tortilla = 45 cal, 5g protein, 4g carbs (0 net), 2g fat

## Vegetables
- Broccoli: 1 cup (91g) = 31 cal, 3g protein, 6g carbs, 0g fat
- Spinach (raw): 2 cups (60g) = 14 cal, 2g protein, 2g carbs, 0g fat
- Spinach (cooked): 1 cup (180g) = 41 cal, 5g protein, 7g carbs, 0g fat
- Mixed greens/salad: 2 cups (80g) = 15 cal, 1g protein, 3g carbs, 0g fat
- Asparagus: 6 spears (90g) = 18 cal, 2g protein, 3g carbs, 0g fat
- Bell peppers: 1 medium (150g) = 37 cal, 1g protein, 7g carbs, 0g fat
- Zucchini: 1 medium (200g) = 34 cal, 2g protein, 6g carbs, 1g fat
- Cauliflower: 1 cup (100g) = 25 cal, 2g protein, 5g carbs, 0g fat

## Fats
- Avocado: 1/2 medium (68g) = 114 cal, 1g protein, 6g carbs, 10g fat
- Olive oil: 1 tbsp (14g) = 119 cal, 0g protein, 0g carbs, 14g fat
- Butter: 1 tbsp (14g) = 102 cal, 0g protein, 0g carbs, 12g fat
- Almonds: 1/4 cup (28g) = 164 cal, 6g protein, 6g carbs, 14g fat
- Peanut butter: 2 tbsp (32g) = 188 cal, 8g protein, 6g carbs, 16g fat
- Cheese (cheddar): 1 oz (28g) = 113 cal, 7g protein, 0g carbs, 9g fat
- Almond milk (unsweetened): 1 cup (240ml) = 30 cal, 1g protein, 1g carbs, 3g fat

## Supplements
- Whey protein: 1 scoop (30g) = 120 cal, 24g protein, 3g carbs, 1g fat
- Protein bar: 1 bar = 200 cal, 20g protein, 22g carbs, 8g fat (varies by brand)
`,
    metadata: { priority: 'high', category: 'portions' },
  },

  // ============================================================================
  // Cooked vs Raw Conversions
  // ============================================================================
  {
    title: 'Cooked vs Raw Conversion Rules',
    source: 'heirclark_nutrition_rules',
    docType: 'cooking_methods',
    text: `# Cooked vs Raw Conversion Rules

When estimating portions, understand whether the user describes raw or cooked food.

## General Rules
- Raw meat loses ~25% weight when cooked (shrinkage from water loss)
- Raw rice/grains DOUBLE in volume when cooked
- Raw pasta increases ~2.5x in volume when cooked
- Vegetables lose ~10-20% weight when cooked

## Protein Conversions
| Raw Weight | Cooked Weight | Example |
|------------|---------------|---------|
| 8 oz (227g) | 6 oz (170g) | Chicken breast |
| 6 oz (170g) | 4.5 oz (128g) | Ground beef/turkey |
| 8 oz (227g) | 6 oz (170g) | Salmon |
| 8 oz (227g) | 6 oz (170g) | Steak |

## Carbohydrate Conversions
| Dry Weight | Cooked Volume | Cooked Weight |
|------------|---------------|---------------|
| 1/2 cup dry rice | 1 cup cooked | 195g |
| 2 oz (56g) dry pasta | 1 cup cooked | 140g |
| 1/2 cup dry quinoa | 1 cup cooked | 185g |
| 1/2 cup dry oats | 1 cup cooked | 234g |

## Key Insight
When users say "8 oz chicken breast" at a restaurant, assume they mean COOKED weight.
When users describe home cooking from raw, ask: "Is that the raw or cooked portion?"

## Calorie Implications
- Macros stay the same whether raw or cooked (you just ate more or less of it)
- Always calculate macros based on the WEIGHT of food consumed
- 6 oz COOKED chicken = same macros as if they ate 6 oz raw (just 6 oz worth)
`,
    metadata: { priority: 'high', category: 'conversions' },
  },

  // ============================================================================
  // Oil & Sauce Defaults
  // ============================================================================
  {
    title: 'Hidden Oils and Sauce Defaults',
    source: 'heirclark_nutrition_rules',
    docType: 'portion_rules',
    text: `# Hidden Oils and Sauce Defaults

Restaurant and home-cooked meals often have hidden calories from oils and sauces.

## Cooking Oil Assumptions
- Pan-fried/sauteed items: Add 1 tbsp oil = +119 cal, +14g fat
- Deep-fried items: Add 2-3 tbsp oil absorbed = +238-357 cal, +28-42g fat
- Grilled/baked: Add 0.5 tbsp oil = +60 cal, +7g fat
- Stir-fry: Add 1.5 tbsp oil = +178 cal, +21g fat
- Roasted vegetables: Add 1 tbsp oil per cup = +119 cal, +14g fat

## Common Sauce Additions
| Sauce | Serving | Calories | Carbs | Fat |
|-------|---------|----------|-------|-----|
| Ranch dressing | 2 tbsp | 145 cal | 1g | 15g |
| Olive oil + vinegar | 2 tbsp | 130 cal | 0g | 14g |
| Teriyaki sauce | 2 tbsp | 30 cal | 6g | 0g |
| BBQ sauce | 2 tbsp | 70 cal | 17g | 0g |
| Sriracha | 1 tsp | 5 cal | 1g | 0g |
| Soy sauce | 1 tbsp | 10 cal | 1g | 0g |
| Honey | 1 tbsp | 64 cal | 17g | 0g |
| Maple syrup | 2 tbsp | 104 cal | 27g | 0g |
| Ketchup | 1 tbsp | 20 cal | 5g | 0g |
| Mayo | 1 tbsp | 94 cal | 0g | 10g |
| Hummus | 2 tbsp | 50 cal | 4g | 3g |
| Guacamole | 2 tbsp | 50 cal | 3g | 4g |
| Salsa | 2 tbsp | 10 cal | 2g | 0g |

## Restaurant Adjustment
For restaurant meals, add +100-200 calories for hidden oils/butter unless:
- Menu explicitly states "steamed", "grilled without oil", or "clean"
- It's a documented clean eating restaurant

## User Cooking Assumptions
If user says "I cooked" without mentioning oil:
- Assume 0.5-1 tbsp oil for basic cooking
- Ask follow-up if it significantly impacts total (e.g., high-calorie meal)
`,
    metadata: { priority: 'medium', category: 'hidden_calories' },
  },

  // ============================================================================
  // Confidence Rubric
  // ============================================================================
  {
    title: 'Estimation Confidence Rubric',
    source: 'heirclark_nutrition_rules',
    docType: 'confidence_rubric',
    text: `# Estimation Confidence Rubric

Use this rubric to set confidence scores for meal estimates.

## High Confidence (80-100)
- User provided specific portions (e.g., "6 oz chicken breast")
- Common, well-documented foods with known macros
- Photo shows clear, identifiable portions
- Single-ingredient or simple meals
- Exact recipe with measured ingredients

Example: "6 oz grilled chicken breast with 1 cup steamed broccoli" → 95% confidence

## Good Confidence (60-79)
- Reasonable portions can be assumed
- Common restaurant dishes with typical serving sizes
- Photo shows food clearly but portions need estimation
- Multi-ingredient meal with common components
- Some assumptions needed but reasonable

Example: "chicken stir-fry from Panda Express" → 70% confidence

## Moderate Confidence (40-59)
- Vague descriptions requiring significant assumptions
- Photo has unclear portions or partial view
- Mixed dishes with unknown proportions
- Restaurant meal without documented nutrition
- Multiple possible interpretations

Example: "some pasta my friend made" → 50% confidence
Example: "had dinner at a local restaurant" → 45% confidence

## Low Confidence (0-39)
- Very vague descriptions
- Unknown restaurants or recipes
- Photo is blurry or food is obscured
- Cannot reasonably estimate portions
- Should ASK follow-up question

Example: "ate something at the party" → 25% confidence
Example: "had some food at work" → 20% confidence

## When to Use Ranges
If confidence is below 60, consider returning min/max ranges instead of single values:
- Range width should reflect uncertainty
- Lower confidence = wider ranges
- Example at 40%: calories might be 400-700 instead of 550

## When to Ask Follow-up
If confidence is below 40, include a follow_up_question:
- Ask about specific portions
- Ask about ingredients
- Ask about preparation method
- Be specific and actionable

Good follow-up: "What was the approximate portion size of the chicken - about the size of your palm, a deck of cards, or larger?"
Bad follow-up: "Can you tell me more?"
`,
    metadata: { priority: 'high', category: 'confidence' },
  },

  // ============================================================================
  // Healthier Swap Suggestions
  // ============================================================================
  {
    title: 'Common Healthier Swaps',
    source: 'heirclark_nutrition_rules',
    docType: 'swap_suggestions',
    text: `# Common Healthier Swaps

When suggesting healthier alternatives, focus on practical swaps that maintain satisfaction.

## Carbohydrate Swaps (Lower Calorie/Higher Fiber)
| Original | Swap | Calorie Savings | Notes |
|----------|------|-----------------|-------|
| White rice (1 cup) | Cauliflower rice | -190 cal | Add seasoning for flavor |
| White rice (1 cup) | Quinoa | +7 cal but +4g protein | Better macro profile |
| Regular pasta (1 cup) | Zucchini noodles | -200 cal | Great for Alfredo/marinara |
| Regular pasta (1 cup) | Chickpea pasta | Same cal but +12g protein | Higher fiber too |
| Flour tortilla | Mission zero carb tortilla | -100 cal, -15g carbs | Almost identical taste |
| White bread | Ezekiel bread | -10 cal, +3g protein | More fiber, sprouted grains |
| Mashed potatoes | Mashed cauliflower | -150 cal | Add cream cheese for creaminess |

## Protein Swaps (Lower Fat)
| Original | Swap | Calorie Savings | Notes |
|----------|------|-----------------|-------|
| Ground beef 80/20 | Ground turkey 93/7 | -100 cal per 4 oz | Season well |
| Chicken thigh | Chicken breast | -50 cal per 4 oz | Brine for moisture |
| Whole eggs (2) | 1 whole + 3 whites | -60 cal | Keeps yolk flavor |
| Regular bacon (3 slices) | Turkey bacon | -50 cal | Crispier texture |
| Salmon | Cod or tilapia | -150 cal per 6 oz | Lower omega-3s though |

## Fat Swaps (Lower Calorie)
| Original | Swap | Calorie Savings | Notes |
|----------|------|-----------------|-------|
| Mayo (1 tbsp) | Greek yogurt (2 tbsp) | -70 cal | Great in tuna salad |
| Sour cream (2 tbsp) | Plain Greek yogurt | -40 cal | Similar tang |
| Butter (1 tbsp) | Olive oil spray | -90 cal | For cooking |
| Ranch dressing (2 tbsp) | Balsamic vinegar | -130 cal | Different flavor profile |
| Cream cheese (2 tbsp) | Neufchatel cheese | -20 cal | Nearly identical taste |
| Regular cheese (1 oz) | Reduced fat cheese | -30 cal | Works best melted |

## Cooking Method Swaps
| Original | Swap | Calorie Savings | Notes |
|----------|------|-----------------|-------|
| Deep-fried | Air-fried | -150-300 cal | Similar crispiness |
| Pan-fried in oil | Grilled or baked | -100 cal | Use non-stick or parchment |
| Cream-based sauce | Tomato-based sauce | -200 cal | Add herbs for depth |
| Butter sauteed | Broth sauteed | -100 cal | Add garlic for flavor |

## Portion Swaps
- Use smaller plates (optical illusion makes portions look larger)
- Fill half plate with vegetables first
- Measure oils instead of pouring
- Share restaurant entrees or take half home

## Satisfaction Tips
- Never suggest "just eat less" without a swap
- Focus on volume eating with low-cal vegetables
- Suggest adding protein to increase satiety
- Recommend flavor enhancers (spices, hot sauce, lemon) over fats
`,
    metadata: { priority: 'medium', category: 'swaps' },
  },

  // ============================================================================
  // Common Meal Patterns
  // ============================================================================
  {
    title: 'Common Meal Patterns and Estimates',
    source: 'heirclark_nutrition_rules',
    docType: 'macro_data',
    text: `# Common Meal Patterns and Estimates

Pre-computed estimates for frequently logged meals.

## Breakfast Patterns
| Meal | Calories | Protein | Carbs | Fat |
|------|----------|---------|-------|-----|
| 2 eggs + 2 bacon + 1 toast | 420 cal | 22g | 18g | 28g |
| Protein shake (whey + almond milk) | 150 cal | 25g | 4g | 4g |
| Oatmeal + banana + peanut butter | 450 cal | 15g | 65g | 18g |
| Greek yogurt + berries + granola | 350 cal | 20g | 45g | 10g |
| Breakfast burrito (eggs, cheese, salsa) | 450 cal | 22g | 35g | 25g |
| Avocado toast (1 slice + 1/2 avocado) | 280 cal | 6g | 22g | 18g |
| Smoothie (fruit, yogurt, protein) | 350 cal | 25g | 45g | 8g |
| Egg white omelette + veggies | 180 cal | 24g | 8g | 5g |

## Lunch Patterns
| Meal | Calories | Protein | Carbs | Fat |
|------|----------|---------|-------|-----|
| Grilled chicken salad (no croutons) | 400 cal | 40g | 15g | 18g |
| Turkey sandwich (wheat bread) | 450 cal | 28g | 42g | 18g |
| Chicken breast + rice + broccoli | 520 cal | 45g | 48g | 12g |
| Burrito bowl (chicken, rice, beans) | 650 cal | 42g | 70g | 20g |
| Tuna salad on greens | 350 cal | 30g | 10g | 22g |
| Soup + half sandwich | 450 cal | 20g | 50g | 18g |

## Dinner Patterns
| Meal | Calories | Protein | Carbs | Fat |
|------|----------|---------|-------|-----|
| Salmon + quinoa + asparagus | 550 cal | 45g | 42g | 22g |
| Steak + sweet potato + salad | 620 cal | 48g | 38g | 28g |
| Chicken stir-fry with rice | 580 cal | 38g | 55g | 20g |
| Ground turkey taco bowl | 550 cal | 40g | 45g | 22g |
| Pasta with meat sauce (1.5 cups) | 650 cal | 28g | 75g | 25g |
| Grilled chicken + roasted vegetables | 420 cal | 45g | 20g | 16g |
| Fish tacos (3 small) | 480 cal | 30g | 42g | 22g |

## Snack Patterns
| Snack | Calories | Protein | Carbs | Fat |
|-------|----------|---------|-------|-----|
| Apple + peanut butter (2 tbsp) | 290 cal | 8g | 35g | 16g |
| Protein bar | 200 cal | 20g | 22g | 8g |
| Handful of almonds (1/4 cup) | 164 cal | 6g | 6g | 14g |
| Greek yogurt | 130 cal | 17g | 8g | 0g |
| Cheese stick + crackers | 180 cal | 8g | 15g | 10g |
| Hummus + vegetables | 150 cal | 5g | 15g | 8g |
| Cottage cheese + berries | 180 cal | 18g | 15g | 3g |
`,
    metadata: { priority: 'medium', category: 'meal_patterns' },
  },

  // ============================================================================
  // Label Reading Rules
  // ============================================================================
  {
    title: 'Nutrition Label Reading Rules',
    source: 'heirclark_nutrition_rules',
    docType: 'portion_rules',
    text: `# Nutrition Label Reading Rules

Help users interpret nutrition labels correctly.

## Serving Size Awareness
- Always check the serving size first
- Many packages contain 2-4 servings
- "Per container" vs "Per serving" - big difference!

## Common Serving Size Traps
| Product | Listed Serving | Typical Actual Consumption |
|---------|----------------|---------------------------|
| Cereal | 3/4 cup | 1.5-2 cups (2-3x label) |
| Ice cream | 1/2 cup | 1-1.5 cups (2-3x label) |
| Chips | 1 oz (15 chips) | 2-3 oz (2-3x label) |
| Soda | 8 oz | 20 oz bottle (2.5x label) |
| Peanut butter | 2 tbsp | 3-4 tbsp (1.5-2x label) |
| Pasta (dry) | 2 oz | 3-4 oz (1.5-2x label) |
| Cookies | 2 cookies | 4-6 cookies (2-3x label) |

## Reading Packaged Foods
1. Find the serving size
2. Estimate how much you actually ate
3. Multiply all values by that ratio
4. Don't forget hidden sugars in "healthy" foods

## Restaurant vs Home Portions
- Restaurant portions are typically 2-3x home portions
- A restaurant chicken breast = 8-12 oz (vs 4-6 oz home)
- Restaurant pasta = 2-3 cups (vs 1 cup home)
- Restaurant steak = 10-16 oz (vs 6-8 oz home)

## Quick Mental Math
For users who don't weigh food:
- Palm = 3-4 oz meat (protein size)
- Fist = 1 cup (carb size)
- Thumb = 1 tbsp (fat size)
- Cupped hand = 1/2 cup
- Two hands cupped = 1 cup

## When Labels Don't Exist
For home-cooked or restaurant meals without labels:
- Use USDA database values for base ingredients
- Add oil/butter used in cooking
- Account for sauces and dressings
- When in doubt, estimate slightly higher
`,
    metadata: { priority: 'medium', category: 'labels' },
  },
];

// ============================================================================
// Main Seeding Function
// ============================================================================

async function seedRagDocuments() {
  console.log('Starting RAG document seeding...\n');

  // Check RAG health first
  const health = await checkRagHealth();
  console.log('RAG System Health:', {
    pgvector: health.pgvector,
    tables: health.tables,
    documentsExisting: health.documentCount,
    chunksExisting: health.chunkCount,
  });

  if (!health.ok) {
    console.error('\nRAG system not ready. Please run migrations first:');
    console.error('  npx ts-node src/db/run-migrations.ts');
    process.exit(1);
  }

  console.log('\n--- Seeding Documents ---\n');

  let successCount = 0;
  let errorCount = 0;

  for (const doc of SEED_DOCUMENTS) {
    try {
      console.log(`Ingesting: ${doc.title}...`);

      const result = await upsertDocumentWithChunks({
        title: doc.title,
        source: doc.source,
        docType: doc.docType,
        text: doc.text,
        metadata: doc.metadata,
        chunkingOptions: {
          chunkSize: 400,
          overlap: 50,
        },
      });

      console.log(`  -> Document ID: ${result.documentId}, Chunks: ${result.chunkCount}`);
      successCount++;
    } catch (error) {
      console.error(`  -> ERROR: ${(error as Error).message}`);
      errorCount++;
    }
  }

  // Final health check
  const finalHealth = await checkRagHealth();

  console.log('\n--- Seeding Complete ---');
  console.log(`Success: ${successCount}, Errors: ${errorCount}`);
  console.log(`Total Documents: ${finalHealth.documentCount}`);
  console.log(`Total Chunks: ${finalHealth.chunkCount}`);

  // Close pool
  await pool.end();
  process.exit(errorCount > 0 ? 1 : 0);
}

// Run if executed directly
seedRagDocuments().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
