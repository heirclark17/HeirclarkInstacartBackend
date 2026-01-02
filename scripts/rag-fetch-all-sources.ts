/**
 * RAG Multi-Source Nutrition Fetcher
 * Fetches from multiple free nutrition APIs to maximize data coverage
 *
 * Run with: npm run rag:fetch-all
 *
 * API Keys needed (all have free tiers):
 * - USDA_API_KEY: https://fdc.nal.usda.gov/api-key-signup.html (free, instant)
 * - NUTRITIONIX_APP_ID + NUTRITIONIX_API_KEY: https://developer.nutritionix.com (free tier)
 * - CALORIENINJAS_API_KEY: https://calorieninjas.com/api (free, 10K/month)
 * - EDAMAM_APP_ID + EDAMAM_APP_KEY: https://developer.edamam.com (free tier)
 */

import 'dotenv/config';
import { pool } from '../src/db/pool';
import { upsertDocumentWithChunks } from '../src/services/rag';

// ============================================================================
// API Configuration
// ============================================================================

const USDA_API_KEY = process.env.USDA_API_KEY || 'DEMO_KEY';
const NUTRITIONIX_APP_ID = process.env.NUTRITIONIX_APP_ID;
const NUTRITIONIX_API_KEY = process.env.NUTRITIONIX_API_KEY;
const CALORIENINJAS_API_KEY = process.env.CALORIENINJAS_API_KEY;

// ============================================================================
// 1. USDA FoodData Central (Free, no key required)
// ============================================================================

async function fetchUSDA(query: string): Promise<string[]> {
  // Use Foundation and SR Legacy data types for better coverage
  const url = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${USDA_API_KEY}&query=${encodeURIComponent(query)}&pageSize=10`;

  try {
    const response = await fetch(url);
    if (!response.ok) return [];

    const data = await response.json();
    const results: string[] = [];

    for (const food of (data.foods || []).slice(0, 5)) {
      const getNutrient = (names: string[]): number => {
        for (const name of names) {
          const n = food.foodNutrients?.find((x: any) =>
            x.nutrientName?.toLowerCase().includes(name.toLowerCase())
          );
          if (n) return Math.round(n.value || 0);
        }
        return 0;
      };

      const cal = getNutrient(['Energy']);
      const protein = getNutrient(['Protein']);
      const carbs = getNutrient(['Carbohydrate']);
      const fat = getNutrient(['Total lipid', 'fat']);

      if (cal > 0) {
        results.push(`- ${food.description}: ${cal} cal, ${protein}g protein, ${carbs}g carbs, ${fat}g fat`);
      }
    }

    return results;
  } catch (error) {
    console.error(`[USDA] Error: ${query}`, (error as Error).message);
    return [];
  }
}

// ============================================================================
// 2. Open Food Facts (Free, no key required, 3M+ products)
// ============================================================================

async function fetchOpenFoodFacts(query: string): Promise<string[]> {
  const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=10`;

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'HeirclarkApp/1.0' }
    });
    if (!response.ok) return [];

    const data = await response.json();
    const results: string[] = [];

    for (const product of (data.products || []).slice(0, 5)) {
      const n = product.nutriments || {};
      const name = product.product_name || product.product_name_en;
      if (!name) continue;

      const cal = Math.round(n['energy-kcal_100g'] || n['energy-kcal_serving'] || 0);
      const protein = Math.round(n['proteins_100g'] || n['proteins_serving'] || 0);
      const carbs = Math.round(n['carbohydrates_100g'] || n['carbohydrates_serving'] || 0);
      const fat = Math.round(n['fat_100g'] || n['fat_serving'] || 0);
      const serving = n['serving_size'] || '100g';

      if (cal > 0) {
        const brand = product.brands ? ` (${product.brands.split(',')[0]})` : '';
        results.push(`- ${name}${brand} per ${serving}: ${cal} cal, ${protein}g protein, ${carbs}g carbs, ${fat}g fat`);
      }
    }

    return results;
  } catch (error) {
    console.error(`[OpenFoodFacts] Error: ${query}`, (error as Error).message);
    return [];
  }
}

// ============================================================================
// 3. CalorieNinjas (Free, 10K calls/month)
// ============================================================================

async function fetchCalorieNinjas(query: string): Promise<string[]> {
  if (!CALORIENINJAS_API_KEY) return [];

  const url = `https://api.calorieninjas.com/v1/nutrition?query=${encodeURIComponent(query)}`;

  try {
    const response = await fetch(url, {
      headers: { 'X-Api-Key': CALORIENINJAS_API_KEY }
    });
    if (!response.ok) return [];

    const data = await response.json();
    const results: string[] = [];

    for (const item of (data.items || [])) {
      const serving = item.serving_size_g ? `${item.serving_size_g}g` : '100g';
      results.push(`- ${item.name} (${serving}): ${Math.round(item.calories)} cal, ${Math.round(item.protein_g)}g protein, ${Math.round(item.carbohydrates_total_g)}g carbs, ${Math.round(item.fat_total_g)}g fat`);
    }

    return results;
  } catch (error) {
    console.error(`[CalorieNinjas] Error: ${query}`, (error as Error).message);
    return [];
  }
}

// ============================================================================
// 4. Nutritionix (Free tier: 500 calls/month - best for restaurants)
// ============================================================================

async function fetchNutritionixRestaurant(restaurant: string): Promise<string[]> {
  if (!NUTRITIONIX_APP_ID || !NUTRITIONIX_API_KEY) return [];

  const url = 'https://trackapi.nutritionix.com/v2/search/instant';

  try {
    const response = await fetch(`${url}?query=${encodeURIComponent(restaurant)}&branded=true&branded_type=1`, {
      headers: {
        'x-app-id': NUTRITIONIX_APP_ID,
        'x-app-key': NUTRITIONIX_API_KEY,
      }
    });
    if (!response.ok) return [];

    const data = await response.json();
    const results: string[] = [];

    for (const item of (data.branded || []).slice(0, 10)) {
      results.push(`- ${item.food_name} (${item.brand_name}): ${Math.round(item.nf_calories || 0)} cal`);
    }

    return results;
  } catch (error) {
    console.error(`[Nutritionix] Error: ${restaurant}`, (error as Error).message);
    return [];
  }
}

// ============================================================================
// Food Categories to Fetch
// ============================================================================

const USDA_QUERIES = [
  // Proteins
  'chicken breast grilled', 'chicken thigh', 'ground beef 90 lean', 'ground beef 80 lean',
  'ground turkey 93', 'ground turkey 85', 'salmon atlantic', 'tilapia', 'cod fish',
  'tuna canned', 'shrimp cooked', 'pork tenderloin', 'pork chop', 'lamb',
  'turkey breast', 'duck', 'venison', 'bison',
  'eggs scrambled', 'eggs fried', 'eggs boiled', 'egg whites',
  'tofu firm', 'tempeh', 'seitan', 'edamame',
  'greek yogurt plain', 'cottage cheese', 'ricotta cheese',

  // Carbs
  'white rice cooked', 'brown rice cooked', 'jasmine rice', 'basmati rice',
  'quinoa cooked', 'couscous', 'bulgur wheat', 'farro',
  'oatmeal cooked', 'cream of wheat', 'grits',
  'pasta cooked', 'spaghetti', 'penne', 'macaroni',
  'bread white', 'bread whole wheat', 'bread sourdough', 'bagel',
  'tortilla flour', 'tortilla corn', 'pita bread', 'naan',
  'sweet potato baked', 'russet potato baked', 'red potato', 'mashed potatoes',
  'banana', 'apple', 'orange', 'grapes', 'strawberries', 'blueberries', 'mango',

  // Vegetables
  'broccoli steamed', 'broccoli raw', 'cauliflower', 'brussels sprouts',
  'spinach raw', 'spinach cooked', 'kale', 'arugula', 'romaine lettuce',
  'asparagus', 'green beans', 'snap peas', 'zucchini', 'squash',
  'bell pepper red', 'bell pepper green', 'onion', 'garlic',
  'carrots', 'celery', 'cucumber', 'tomato', 'mushrooms',
  'corn', 'peas', 'beets', 'eggplant',

  // Fats & Nuts
  'avocado', 'olive oil', 'coconut oil', 'butter',
  'almonds', 'walnuts', 'cashews', 'peanuts', 'macadamia nuts', 'pistachios',
  'peanut butter', 'almond butter', 'tahini',
  'cheese cheddar', 'cheese mozzarella', 'cheese parmesan', 'cheese feta', 'cheese goat',
  'cream cheese', 'sour cream', 'heavy cream',

  // Legumes
  'black beans', 'kidney beans', 'chickpeas', 'lentils', 'split peas',
  'hummus', 'refried beans',

  // Dairy Alternatives
  'almond milk', 'oat milk', 'soy milk', 'coconut milk',

  // Condiments & Sauces
  'honey', 'maple syrup', 'ketchup', 'mustard', 'mayonnaise',
  'soy sauce', 'teriyaki sauce', 'hot sauce', 'salsa', 'guacamole',
  'ranch dressing', 'italian dressing', 'balsamic vinegar',
];

const OPEN_FOOD_FACTS_QUERIES = [
  // Popular brands
  'Chobani greek yogurt',
  'Fage greek yogurt',
  'Siggi yogurt',
  'Oikos yogurt',
  'Fairlife protein shake',
  'Premier Protein shake',
  'Muscle Milk',
  'Core Power',
  'RXBAR',
  'Kind bar',
  'Larabar',
  'Clif bar',
  'Nature Valley',
  'Quest chips',
  'Baked Lays',
  'Skinny Pop popcorn',
  'Boom Chicka Pop',
  'Siete chips',
  'Whisps cheese crisps',
  'Moon Cheese',
  'Epic jerky',
  'Chomps beef sticks',
  'Country Archer jerky',
  'Wonderful pistachios',
  'Blue Diamond almonds',
  'Justin almond butter',
  'RX nut butter',
  'Kodiak pancake mix',
  'Birch Benders pancake',
  'Banza chickpea pasta',
  'Barilla protein pasta',
  'Rao marinara sauce',
  "Primal Kitchen mayo",
  'Tessamae dressing',
  'Hu chocolate',
  'Lily chocolate',
  'Halo Top ice cream',
  'Enlightened ice cream',
  'Yasso frozen yogurt',
  'Caulipower pizza',
  'Siete tortillas',
];

// ============================================================================
// Main Fetch Function
// ============================================================================

async function fetchAllSources() {
  console.log('=== Multi-Source Nutrition Data Fetch ===\n');
  console.log('API Keys configured:');
  console.log('  - USDA:', USDA_API_KEY ? 'Yes' : 'Using DEMO_KEY');
  console.log('  - CalorieNinjas:', CALORIENINJAS_API_KEY ? 'Yes' : 'No');
  console.log('  - Nutritionix:', NUTRITIONIX_APP_ID ? 'Yes' : 'No');
  console.log('');

  const allData: { source: string; items: string[] }[] = [];

  // 1. USDA FoodData Central
  console.log('--- Fetching from USDA FoodData Central ---');
  const usdaItems: string[] = [];
  for (const query of USDA_QUERIES) {
    process.stdout.write(`  ${query}...`);
    const items = await fetchUSDA(query);
    usdaItems.push(...items);
    console.log(` ${items.length} items`);
    await sleep(150); // Rate limit
  }
  allData.push({ source: 'USDA', items: usdaItems });
  console.log(`  Total: ${usdaItems.length} items\n`);

  // 2. Open Food Facts
  console.log('--- Fetching from Open Food Facts ---');
  const offItems: string[] = [];
  for (const query of OPEN_FOOD_FACTS_QUERIES) {
    process.stdout.write(`  ${query}...`);
    const items = await fetchOpenFoodFacts(query);
    offItems.push(...items);
    console.log(` ${items.length} items`);
    await sleep(500); // Be nice to free API
  }
  allData.push({ source: 'Open Food Facts', items: offItems });
  console.log(`  Total: ${offItems.length} items\n`);

  // 3. CalorieNinjas (if API key provided)
  if (CALORIENINJAS_API_KEY) {
    console.log('--- Fetching from CalorieNinjas ---');
    const cnItems: string[] = [];
    const cnQueries = ['1 cup rice', '6 oz chicken breast', '1 banana', '2 eggs scrambled', '1 cup oatmeal'];
    for (const query of cnQueries) {
      process.stdout.write(`  ${query}...`);
      const items = await fetchCalorieNinjas(query);
      cnItems.push(...items);
      console.log(` ${items.length} items`);
      await sleep(200);
    }
    allData.push({ source: 'CalorieNinjas', items: cnItems });
    console.log(`  Total: ${cnItems.length} items\n`);
  }

  // 4. Create and seed documents
  console.log('--- Seeding to RAG Database ---\n');

  for (const { source, items } of allData) {
    if (items.length === 0) continue;

    const docTitle = `${source} Foods Database`;
    const docText = `# ${source} Nutrition Database\n\nData sourced from ${source}.\n\n## Foods\n${items.join('\n')}`;

    try {
      console.log(`Ingesting: ${docTitle} (${items.length} items)...`);
      const result = await upsertDocumentWithChunks({
        title: docTitle,
        source: source.toLowerCase().replace(/\s+/g, '_') as any,
        docType: 'macro_data',
        text: docText,
      });
      console.log(`  -> Chunks: ${result.chunkCount}`);
    } catch (error) {
      console.error(`  -> ERROR: ${(error as Error).message}`);
    }
  }

  // Summary
  const docCount = await pool.query('SELECT COUNT(*) FROM rag_documents');
  const chunkCount = await pool.query('SELECT COUNT(*) FROM rag_chunks');

  console.log('\n=== Complete ===');
  console.log(`Total Documents: ${docCount.rows[0].count}`);
  console.log(`Total Chunks: ${chunkCount.rows[0].count}`);

  await pool.end();
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Run
fetchAllSources().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
