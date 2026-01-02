/**
 * RAG Nutrition Data Fetcher
 * Fetches nutrition data from free APIs and seeds into RAG system
 *
 * Run with: npx ts-node scripts/rag-fetch-nutrition-data.ts
 */

import 'dotenv/config';
import { pool } from '../src/db/pool';
import { upsertDocumentWithChunks } from '../src/services/rag';

// ============================================================================
// USDA FoodData Central (Free, no API key required for basic access)
// ============================================================================

const USDA_API_KEY = process.env.USDA_API_KEY || 'DEMO_KEY'; // Get free key at https://fdc.nal.usda.gov/api-key-signup.html

interface USDAFood {
  description: string;
  foodNutrients: Array<{
    nutrientName: string;
    value: number;
    unitName: string;
  }>;
  servingSize?: number;
  servingSizeUnit?: string;
}

async function fetchUSDAFoods(query: string, pageSize: number = 25): Promise<USDAFood[]> {
  const url = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${USDA_API_KEY}&query=${encodeURIComponent(query)}&pageSize=${pageSize}&dataType=Survey%20(FNDDS)`;

  try {
    const response = await fetch(url);
    const data = await response.json();
    return data.foods || [];
  } catch (error) {
    console.error(`[USDA] Error fetching "${query}":`, error);
    return [];
  }
}

function extractMacros(food: USDAFood): { calories: number; protein: number; carbs: number; fat: number } {
  const getNutrient = (names: string[]): number => {
    for (const name of names) {
      const nutrient = food.foodNutrients.find(n =>
        n.nutrientName.toLowerCase().includes(name.toLowerCase())
      );
      if (nutrient) return Math.round(nutrient.value);
    }
    return 0;
  };

  return {
    calories: getNutrient(['Energy', 'Calories']),
    protein: getNutrient(['Protein']),
    carbs: getNutrient(['Carbohydrate']),
    fat: getNutrient(['Total lipid', 'Fat']),
  };
}

// ============================================================================
// Common Food Categories to Fetch
// ============================================================================

const FOOD_QUERIES = [
  // Proteins
  'grilled chicken breast',
  'ground beef',
  'ground turkey',
  'salmon fillet',
  'tuna',
  'shrimp',
  'eggs',
  'egg whites',
  'tofu',
  'greek yogurt',
  'cottage cheese',
  'protein powder whey',

  // Carbs
  'white rice cooked',
  'brown rice cooked',
  'quinoa cooked',
  'oatmeal',
  'sweet potato',
  'pasta cooked',
  'bread whole wheat',
  'tortilla flour',
  'banana',
  'apple',

  // Vegetables
  'broccoli',
  'spinach',
  'kale',
  'asparagus',
  'green beans',
  'bell pepper',
  'zucchini',
  'cauliflower',
  'carrots',
  'mixed salad greens',

  // Fats
  'avocado',
  'olive oil',
  'almonds',
  'peanut butter',
  'cheese cheddar',
  'butter',
  'coconut oil',
];

// ============================================================================
// Popular Restaurant Data (Manually curated - these don't have free APIs)
// ============================================================================

const RESTAURANT_DATA = `# Popular Restaurant Meals

## Chipotle Mexican Grill
- Chicken burrito bowl (white rice, black beans, fajita veggies, salsa, cheese, lettuce): 745 cal, 45g protein, 75g carbs, 28g fat
- Chicken burrito bowl (no rice, double chicken, fajita veggies, salsa): 410 cal, 56g protein, 18g carbs, 14g fat
- Steak burrito bowl (white rice, pinto beans, salsa, cheese, sour cream, guac): 1030 cal, 48g protein, 80g carbs, 55g fat
- Chicken burrito (flour tortilla, rice, beans, salsa, cheese): 1055 cal, 55g protein, 108g carbs, 40g fat
- Carnitas bowl (rice, beans, salsa, cheese): 820 cal, 38g protein, 78g carbs, 38g fat
- Sofritas bowl (rice, beans, salsa, guac): 695 cal, 20g protein, 82g carbs, 32g fat
- Chips and guacamole: 770 cal, 10g protein, 66g carbs, 54g fat
- Side of guacamole: 230 cal, 3g protein, 12g carbs, 22g fat

## Chick-fil-A
- Grilled chicken sandwich: 320 cal, 29g protein, 41g carbs, 6g fat
- Spicy chicken sandwich: 450 cal, 28g protein, 45g carbs, 18g fat
- Spicy deluxe sandwich: 550 cal, 33g protein, 48g carbs, 24g fat
- Grilled nuggets (8 ct): 130 cal, 25g protein, 3g carbs, 3g fat
- Grilled nuggets (12 ct): 200 cal, 38g protein, 4g carbs, 4g fat
- Chicken nuggets (8 ct): 250 cal, 27g protein, 11g carbs, 11g fat
- Grilled cool wrap: 350 cal, 37g protein, 29g carbs, 13g fat
- Cobb salad with grilled chicken: 510 cal, 40g protein, 27g carbs, 28g fat
- Market salad with grilled chicken: 340 cal, 28g protein, 25g carbs, 14g fat
- Waffle fries (medium): 420 cal, 5g protein, 48g carbs, 24g fat
- Fruit cup (medium): 60 cal, 1g protein, 16g carbs, 0g fat

## Sweetgreen
- Harvest bowl: 620 cal, 25g protein, 52g carbs, 35g fat
- Kale caesar (with chicken): 480 cal, 33g protein, 24g carbs, 30g fat
- Shroomami: 520 cal, 18g protein, 58g carbs, 28g fat
- Chicken pesto parm: 630 cal, 35g protein, 48g carbs, 34g fat
- Buffalo chicken bowl: 575 cal, 36g protein, 42g carbs, 30g fat
- Guacamole greens: 530 cal, 12g protein, 36g carbs, 40g fat
- Super green goddess: 490 cal, 8g protein, 32g carbs, 38g fat

## Cava
- Greens + grilled chicken + hummus + lemon herb tahini: 540 cal, 40g protein, 28g carbs, 32g fat
- Pita + grilled chicken + tzatziki + vegetables: 620 cal, 42g protein, 55g carbs, 25g fat
- Greens + falafel + hummus + vegetables: 485 cal, 16g protein, 42g carbs, 30g fat
- Grain bowl + lamb + harissa + vegetables: 720 cal, 35g protein, 68g carbs, 35g fat
- RightRice bowl + chicken + supergreens: 580 cal, 45g protein, 52g carbs, 22g fat

## Panera Bread
- Greek salad with chicken: 400 cal, 32g protein, 16g carbs, 24g fat
- Asian sesame salad with chicken: 430 cal, 32g protein, 33g carbs, 20g fat
- Mediterranean veggie sandwich: 560 cal, 20g protein, 72g carbs, 22g fat
- Turkey avocado BLT: 620 cal, 35g protein, 56g carbs, 28g fat
- Fuji apple chicken salad: 550 cal, 30g protein, 40g carbs, 32g fat
- Ten vegetable soup (cup): 100 cal, 4g protein, 18g carbs, 2g fat
- Chicken noodle soup (cup): 110 cal, 8g protein, 14g carbs, 3g fat
- Broccoli cheddar soup (cup): 240 cal, 9g protein, 15g carbs, 16g fat

## Subway (6-inch subs on 9-grain wheat)
- Turkey breast: 280 cal, 18g protein, 42g carbs, 4g fat
- Oven roasted chicken: 320 cal, 23g protein, 42g carbs, 5g fat
- Veggie delite: 230 cal, 9g protein, 40g carbs, 3g fat
- Tuna: 460 cal, 20g protein, 42g carbs, 22g fat
- Italian BMT: 400 cal, 18g protein, 44g carbs, 16g fat
- Steak and cheese: 380 cal, 26g protein, 43g carbs, 11g fat
- Chicken teriyaki: 370 cal, 26g protein, 48g carbs, 5g fat

## Starbucks
- Egg white & roasted red pepper sous vide eggs (2): 170 cal, 13g protein, 11g carbs, 8g fat
- Bacon & gruyere sous vide eggs (2): 300 cal, 19g protein, 9g carbs, 20g fat
- Protein box (cheese & fruit): 470 cal, 20g protein, 43g carbs, 25g fat
- Spinach feta wrap: 290 cal, 20g protein, 34g carbs, 8g fat
- Turkey bacon & egg white sandwich: 230 cal, 17g protein, 25g carbs, 6g fat
- Oatmeal: 160 cal, 5g protein, 28g carbs, 3g fat
- Avocado spread: 90 cal, 1g protein, 5g carbs, 8g fat

## McDonald's
- Egg McMuffin: 310 cal, 17g protein, 30g carbs, 13g fat
- McChicken: 400 cal, 14g protein, 40g carbs, 21g fat
- Grilled chicken sandwich: 380 cal, 37g protein, 44g carbs, 7g fat
- Big Mac: 550 cal, 25g protein, 45g carbs, 30g fat
- Quarter Pounder with cheese: 520 cal, 30g protein, 42g carbs, 26g fat
- 10 pc chicken nuggets: 410 cal, 22g protein, 26g carbs, 24g fat
- Medium fries: 320 cal, 5g protein, 43g carbs, 15g fat
- Side salad: 15 cal, 1g protein, 3g carbs, 0g fat
- Southwest salad with grilled chicken: 350 cal, 37g protein, 27g carbs, 11g fat

## Wendy's
- Grilled chicken sandwich: 370 cal, 34g protein, 38g carbs, 10g fat
- Jr hamburger: 250 cal, 13g protein, 25g carbs, 11g fat
- Baconator: 950 cal, 57g protein, 38g carbs, 65g fat
- 4 pc chicken nuggets: 180 cal, 9g protein, 12g carbs, 11g fat
- Apple pecan salad (half, grilled chicken): 340 cal, 22g protein, 25g carbs, 16g fat
- Chili (small): 170 cal, 14g protein, 15g carbs, 6g fat
- Plain baked potato: 270 cal, 7g protein, 61g carbs, 0g fat

## Taco Bell
- Power menu bowl (chicken): 470 cal, 26g protein, 50g carbs, 18g fat
- Chicken soft taco: 160 cal, 11g protein, 16g carbs, 6g fat
- Crunchy taco: 170 cal, 8g protein, 12g carbs, 10g fat
- Bean burrito: 380 cal, 14g protein, 55g carbs, 11g fat
- Chicken quesadilla: 500 cal, 27g protein, 40g carbs, 26g fat
- Black beans and rice: 200 cal, 6g protein, 34g carbs, 4g fat
- Fiesta veggie burrito: 430 cal, 12g protein, 63g carbs, 14g fat

## Panda Express
- Grilled teriyaki chicken: 300 cal, 36g protein, 14g carbs, 13g fat
- String bean chicken breast: 190 cal, 14g protein, 13g carbs, 9g fat
- Broccoli beef: 150 cal, 10g protein, 13g carbs, 7g fat
- Orange chicken: 490 cal, 25g protein, 51g carbs, 21g fat
- Kung pao chicken: 290 cal, 16g protein, 16g carbs, 19g fat
- Beijing beef: 470 cal, 14g protein, 46g carbs, 26g fat
- Super greens: 90 cal, 6g protein, 10g carbs, 3g fat
- Fried rice: 520 cal, 12g protein, 82g carbs, 16g fat
- White steamed rice: 380 cal, 7g protein, 87g carbs, 0g fat
- Brown steamed rice: 420 cal, 9g protein, 86g carbs, 4g fat
`;

const GROCERY_DATA = `# Popular Grocery Store Products

## Trader Joe's
- Cauliflower gnocchi (1 cup cooked): 140 cal, 4g protein, 22g carbs, 5g fat
- Chicken sausage, sweet apple (1 link): 140 cal, 13g protein, 3g carbs, 8g fat
- Everything but the bagel salmon (3 oz): 120 cal, 17g protein, 2g carbs, 6g fat
- Unexpected cheddar cheese (1 oz): 110 cal, 7g protein, 0g carbs, 9g fat
- Reduced guilt mac and cheese (1 cup): 270 cal, 14g protein, 40g carbs, 6g fat
- Cauliflower rice (1 cup): 25 cal, 2g protein, 4g carbs, 0g fat
- Zhoug sauce (1 tbsp): 60 cal, 0g protein, 1g carbs, 6g fat
- Gone bananas chocolate covered bananas (4 pieces): 130 cal, 1g protein, 18g carbs, 6g fat
- Dark chocolate peanut butter cups (2 pieces): 180 cal, 4g protein, 15g carbs, 12g fat

## Costco / Kirkland
- Kirkland rotisserie chicken (4 oz meat): 180 cal, 25g protein, 0g carbs, 9g fat
- Kirkland protein bars (1 bar): 190 cal, 21g protein, 22g carbs, 7g fat
- Kirkland organic eggs (1 large): 70 cal, 6g protein, 0g carbs, 5g fat
- Kirkland almond butter (2 tbsp): 190 cal, 7g protein, 6g carbs, 17g fat
- Kirkland greek yogurt (1 cup): 130 cal, 18g protein, 9g carbs, 0g fat
- Kirkland organic chicken breast (6 oz): 280 cal, 52g protein, 0g carbs, 6g fat
- Kirkland wild salmon (4 oz): 180 cal, 25g protein, 0g carbs, 9g fat
- Kirkland quinoa (1 cup cooked): 222 cal, 8g protein, 39g carbs, 4g fat

## Whole Foods / 365 Brand
- 365 organic chicken breast (6 oz): 280 cal, 52g protein, 0g carbs, 6g fat
- 365 organic ground beef 85/15 (4 oz): 240 cal, 21g protein, 0g carbs, 17g fat
- 365 organic eggs (1 large): 70 cal, 6g protein, 0g carbs, 5g fat
- 365 organic whole milk (1 cup): 150 cal, 8g protein, 12g carbs, 8g fat
- 365 almond milk unsweetened (1 cup): 30 cal, 1g protein, 1g carbs, 3g fat
- 365 organic brown rice (1 cup cooked): 215 cal, 5g protein, 45g carbs, 2g fat

## Target / Good & Gather
- Good & Gather chicken breast (6 oz): 280 cal, 52g protein, 0g carbs, 6g fat
- Good & Gather greek yogurt (1 cup): 130 cal, 17g protein, 8g carbs, 0g fat
- Good & Gather cottage cheese (1 cup): 180 cal, 24g protein, 8g carbs, 4g fat
- Good & Gather string cheese (1 stick): 80 cal, 7g protein, 1g carbs, 5g fat
- Good & Gather hummus (2 tbsp): 70 cal, 2g protein, 5g carbs, 5g fat

## Common Protein Powders
- Optimum Nutrition Gold Standard Whey (1 scoop): 120 cal, 24g protein, 3g carbs, 1g fat
- Dymatize ISO100 (1 scoop): 110 cal, 25g protein, 1g carbs, 0g fat
- Orgain Organic Protein (1 scoop): 150 cal, 21g protein, 15g carbs, 4g fat
- Garden of Life Raw Organic (1 scoop): 130 cal, 22g protein, 7g carbs, 2g fat
- Quest Protein Powder (1 scoop): 110 cal, 23g protein, 3g carbs, 0.5g fat
- Vital Proteins Collagen Peptides (2 scoops): 70 cal, 18g protein, 0g carbs, 0g fat
- PEScience Select Protein (1 scoop): 120 cal, 24g protein, 4g carbs, 1g fat
- Ghost Whey (1 scoop): 130 cal, 25g protein, 5g carbs, 1.5g fat

## Common Protein Bars
- RXBar (1 bar): 210 cal, 12g protein, 23g carbs, 9g fat
- Quest Bar (1 bar): 200 cal, 21g protein, 21g carbs, 8g fat
- Kind Protein Bar (1 bar): 250 cal, 12g protein, 18g carbs, 17g fat
- ONE Bar (1 bar): 220 cal, 20g protein, 23g carbs, 8g fat
- Built Bar (1 bar): 130 cal, 17g protein, 15g carbs, 3g fat
- Barebells Protein Bar (1 bar): 200 cal, 20g protein, 18g carbs, 8g fat
- Perfect Bar (1 bar): 330 cal, 17g protein, 27g carbs, 19g fat
- GoMacro Bar (1 bar): 260 cal, 11g protein, 38g carbs, 8g fat
`;

// ============================================================================
// Main Function
// ============================================================================

async function fetchAndSeedNutritionData() {
  console.log('Fetching nutrition data from external sources...\n');

  // 1. Fetch USDA data for common foods
  console.log('--- Fetching USDA Food Data ---\n');

  const usdaFoods: string[] = [];

  for (const query of FOOD_QUERIES) {
    console.log(`Fetching: ${query}...`);
    const foods = await fetchUSDAFoods(query, 3);

    for (const food of foods) {
      const macros = extractMacros(food);
      if (macros.calories > 0) {
        const serving = food.servingSize
          ? `${food.servingSize}${food.servingSizeUnit || 'g'}`
          : '100g';
        usdaFoods.push(
          `- ${food.description} (${serving}): ${macros.calories} cal, ${macros.protein}g protein, ${macros.carbs}g carbs, ${macros.fat}g fat`
        );
      }
    }

    // Rate limit - USDA allows 1000/hour with DEMO_KEY
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  // 2. Create USDA document
  console.log(`\nFetched ${usdaFoods.length} foods from USDA\n`);

  const usdaDocument = `# USDA Food Database - Common Foods

This data is from the USDA FoodData Central database.

## Foods
${usdaFoods.join('\n')}
`;

  // 3. Seed all documents
  console.log('--- Seeding Documents ---\n');

  const documents = [
    {
      title: 'USDA Common Foods Database',
      source: 'usda' as const,
      docType: 'macro_data' as const,
      text: usdaDocument,
    },
    {
      title: 'Restaurant Nutrition Data',
      source: 'nutritionist' as const,
      docType: 'macro_data' as const,
      text: RESTAURANT_DATA,
    },
    {
      title: 'Grocery Store Products',
      source: 'nutritionist' as const,
      docType: 'macro_data' as const,
      text: GROCERY_DATA,
    },
  ];

  for (const doc of documents) {
    try {
      console.log(`Ingesting: ${doc.title}...`);
      const result = await upsertDocumentWithChunks({
        title: doc.title,
        source: doc.source,
        docType: doc.docType,
        text: doc.text,
      });
      console.log(`  -> Document ID: ${result.documentId}, Chunks: ${result.chunkCount}`);
    } catch (error) {
      console.error(`  -> ERROR: ${(error as Error).message}`);
    }
  }

  // 4. Summary
  const docCount = await pool.query('SELECT COUNT(*) FROM rag_documents');
  const chunkCount = await pool.query('SELECT COUNT(*) FROM rag_chunks');

  console.log('\n--- Complete ---');
  console.log(`Total Documents: ${docCount.rows[0].count}`);
  console.log(`Total Chunks: ${chunkCount.rows[0].count}`);

  await pool.end();
}

// Run
fetchAndSeedNutritionData().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
