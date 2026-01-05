// scripts/seed-usda-foods.ts
// Seed nutrition_foods table from USDA FoodData Central API
// API Docs: https://fdc.nal.usda.gov/api-guide.html

import 'dotenv/config';
import { Pool } from 'pg';
import axios from 'axios';

const DATABASE_URL = process.env.DATABASE_URL || '';
const USDA_API_KEY = process.env.USDA_API_KEY || 'DEMO_KEY'; // DEMO_KEY has rate limits

if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : undefined,
});

const USDA_BASE_URL = 'https://api.nal.usda.gov/fdc/v1';

// Food categories to fetch
const FOOD_CATEGORIES = [
  'Dairy and Egg Products',
  'Spices and Herbs',
  'Fats and Oils',
  'Poultry Products',
  'Soups, Sauces, and Gravies',
  'Sausages and Luncheon Meats',
  'Breakfast Cereals',
  'Fruits and Fruit Juices',
  'Pork Products',
  'Vegetables and Vegetable Products',
  'Nut and Seed Products',
  'Beef Products',
  'Beverages',
  'Finfish and Shellfish Products',
  'Legumes and Legume Products',
  'Lamb, Veal, and Game Products',
  'Baked Products',
  'Snacks',
  'Sweets',
  'Cereal Grains and Pasta',
  'Fast Foods',
  'Meals, Entrees, and Side Dishes',
  'Restaurant Foods',
];

// Nutrient IDs from USDA
const NUTRIENT_IDS = {
  calories: 1008,      // Energy (kcal)
  protein: 1003,       // Protein (g)
  fat: 1004,           // Total lipid (fat) (g)
  carbs: 1005,         // Carbohydrate, by difference (g)
  fiber: 1079,         // Fiber, total dietary (g)
  sugar: 2000,         // Sugars, total (g)
  sodium: 1093,        // Sodium (mg)
  cholesterol: 1253,   // Cholesterol (mg)
  saturated_fat: 1258, // Fatty acids, total saturated (g)
  potassium: 1092,     // Potassium (mg)
  vitamin_a: 1106,     // Vitamin A, IU
  vitamin_c: 1162,     // Vitamin C (mg)
  calcium: 1087,       // Calcium (mg)
  iron: 1089,          // Iron (mg)
};

interface USDAFood {
  fdcId: number;
  description: string;
  dataType: string;
  brandOwner?: string;
  brandName?: string;
  gtinUpc?: string;
  foodCategory?: string;
  foodNutrients: Array<{
    nutrientId: number;
    nutrientName: string;
    value: number;
    unitName: string;
  }>;
  servingSize?: number;
  servingSizeUnit?: string;
  householdServingFullText?: string;
}

function getNutrientValue(food: USDAFood, nutrientId: number): number | null {
  const nutrient = food.foodNutrients.find(n => n.nutrientId === nutrientId);
  return nutrient ? nutrient.value : null;
}

function mapUSDAToNutritionFood(food: USDAFood) {
  const calories = getNutrientValue(food, NUTRIENT_IDS.calories) || 0;
  const protein = getNutrientValue(food, NUTRIENT_IDS.protein) || 0;
  const fat = getNutrientValue(food, NUTRIENT_IDS.fat) || 0;
  const carbs = getNutrientValue(food, NUTRIENT_IDS.carbs) || 0;

  // Determine dietary flags
  const dietaryFlags: string[] = [];
  if (protein >= 20) dietaryFlags.push('high_protein');
  if (getNutrientValue(food, NUTRIENT_IDS.sodium) && getNutrientValue(food, NUTRIENT_IDS.sodium)! < 140) {
    dietaryFlags.push('low_sodium');
  }
  if (carbs < 5 && calories > 0) dietaryFlags.push('keto_friendly');

  return {
    name: food.description,
    brand: food.brandOwner || food.brandName || null,
    category: food.foodCategory || null,
    upc: food.gtinUpc || null,
    calories,
    protein_g: protein,
    carbs_g: carbs,
    fat_g: fat,
    fiber_g: getNutrientValue(food, NUTRIENT_IDS.fiber),
    sugar_g: getNutrientValue(food, NUTRIENT_IDS.sugar),
    sodium_mg: getNutrientValue(food, NUTRIENT_IDS.sodium),
    cholesterol_mg: getNutrientValue(food, NUTRIENT_IDS.cholesterol),
    saturated_fat_g: getNutrientValue(food, NUTRIENT_IDS.saturated_fat),
    potassium_mg: getNutrientValue(food, NUTRIENT_IDS.potassium),
    vitamin_a_iu: getNutrientValue(food, NUTRIENT_IDS.vitamin_a),
    vitamin_c_mg: getNutrientValue(food, NUTRIENT_IDS.vitamin_c),
    calcium_mg: getNutrientValue(food, NUTRIENT_IDS.calcium),
    iron_mg: getNutrientValue(food, NUTRIENT_IDS.iron),
    serving_amount: food.servingSize || 100,
    serving_unit: food.servingSizeUnit || 'g',
    serving_grams: food.servingSize || 100,
    serving_description: food.householdServingFullText || null,
    verification_status: 'verified',
    quality_score: 85, // USDA data is high quality
    source: 'usda',
    source_id: food.fdcId.toString(),
    dietary_flags: dietaryFlags,
  };
}

async function fetchUSDAFoods(
  dataType: string,
  pageSize: number = 200,
  pageNumber: number = 1
): Promise<USDAFood[]> {
  try {
    const response = await axios.post(
      `${USDA_BASE_URL}/foods/search?api_key=${USDA_API_KEY}`,
      {
        dataType: [dataType],
        pageSize,
        pageNumber,
        sortBy: 'dataType.keyword',
        sortOrder: 'asc',
      },
      {
        headers: { 'Content-Type': 'application/json' },
      }
    );

    return response.data.foods || [];
  } catch (error: any) {
    console.error(`Error fetching USDA foods:`, error.message);
    return [];
  }
}

async function fetchFoundationFoods(pageSize: number = 200, pageNumber: number = 1): Promise<USDAFood[]> {
  return fetchUSDAFoods('Foundation', pageSize, pageNumber);
}

async function fetchSRLegacyFoods(pageSize: number = 200, pageNumber: number = 1): Promise<USDAFood[]> {
  return fetchUSDAFoods('SR Legacy', pageSize, pageNumber);
}

async function fetchBrandedFoods(pageSize: number = 200, pageNumber: number = 1): Promise<USDAFood[]> {
  return fetchUSDAFoods('Branded', pageSize, pageNumber);
}

async function insertFood(food: ReturnType<typeof mapUSDAToNutritionFood>): Promise<boolean> {
  try {
    await pool.query(
      `INSERT INTO nutrition_foods (
        name, brand, category, upc,
        calories, protein_g, carbs_g, fat_g, fiber_g, sugar_g,
        sodium_mg, cholesterol_mg, saturated_fat_g, potassium_mg,
        vitamin_a_iu, vitamin_c_mg, calcium_mg, iron_mg,
        serving_amount, serving_unit, serving_grams, serving_description,
        verification_status, quality_score, source, source_id, dietary_flags
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14,
        $15, $16, $17, $18,
        $19, $20, $21, $22,
        $23, $24, $25, $26, $27
      )
      ON CONFLICT (upc) DO UPDATE SET
        name = EXCLUDED.name,
        calories = EXCLUDED.calories,
        protein_g = EXCLUDED.protein_g,
        carbs_g = EXCLUDED.carbs_g,
        fat_g = EXCLUDED.fat_g,
        updated_at = NOW()
      WHERE nutrition_foods.upc IS NOT NULL`,
      [
        food.name,
        food.brand,
        food.category,
        food.upc,
        food.calories,
        food.protein_g,
        food.carbs_g,
        food.fat_g,
        food.fiber_g,
        food.sugar_g,
        food.sodium_mg,
        food.cholesterol_mg,
        food.saturated_fat_g,
        food.potassium_mg,
        food.vitamin_a_iu,
        food.vitamin_c_mg,
        food.calcium_mg,
        food.iron_mg,
        food.serving_amount,
        food.serving_unit,
        food.serving_grams,
        food.serving_description,
        food.verification_status,
        food.quality_score,
        food.source,
        food.source_id,
        JSON.stringify(food.dietary_flags),
      ]
    );
    return true;
  } catch (error: any) {
    // Ignore duplicate key errors for foods without UPC
    if (!error.message.includes('duplicate')) {
      console.error(`Error inserting food "${food.name}":`, error.message);
    }
    return false;
  }
}

async function seedUSDAFoods() {
  console.log('Starting USDA Food Database Seeding...\n');
  console.log(`Using API Key: ${USDA_API_KEY === 'DEMO_KEY' ? 'DEMO_KEY (rate limited)' : 'Custom key'}\n`);

  let totalInserted = 0;
  let totalFailed = 0;

  // Fetch Foundation Foods (high quality, ~1000 foods)
  console.log('Fetching Foundation Foods...');
  for (let page = 1; page <= 10; page++) {
    const foods = await fetchFoundationFoods(200, page);
    if (foods.length === 0) break;

    console.log(`  Page ${page}: ${foods.length} foods`);

    for (const food of foods) {
      const mapped = mapUSDAToNutritionFood(food);
      const success = await insertFood(mapped);
      if (success) totalInserted++;
      else totalFailed++;
    }

    // Rate limiting for DEMO_KEY
    if (USDA_API_KEY === 'DEMO_KEY') {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  // Fetch SR Legacy Foods (comprehensive, ~8000 foods)
  console.log('\nFetching SR Legacy Foods...');
  for (let page = 1; page <= 50; page++) {
    const foods = await fetchSRLegacyFoods(200, page);
    if (foods.length === 0) break;

    console.log(`  Page ${page}: ${foods.length} foods`);

    for (const food of foods) {
      const mapped = mapUSDAToNutritionFood(food);
      const success = await insertFood(mapped);
      if (success) totalInserted++;
      else totalFailed++;
    }

    // Rate limiting
    if (USDA_API_KEY === 'DEMO_KEY') {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  // Fetch some Branded Foods (popular brands, limited to avoid huge data)
  console.log('\nFetching Branded Foods (sample)...');
  for (let page = 1; page <= 20; page++) {
    const foods = await fetchBrandedFoods(200, page);
    if (foods.length === 0) break;

    console.log(`  Page ${page}: ${foods.length} foods`);

    for (const food of foods) {
      const mapped = mapUSDAToNutritionFood(food);
      mapped.verification_status = 'verified';
      mapped.quality_score = 75; // Branded data slightly lower quality
      mapped.source = 'branded';
      const success = await insertFood(mapped);
      if (success) totalInserted++;
      else totalFailed++;
    }

    // Rate limiting
    if (USDA_API_KEY === 'DEMO_KEY') {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  console.log('\n========================================');
  console.log(`Seeding Complete!`);
  console.log(`  Inserted: ${totalInserted}`);
  console.log(`  Failed/Skipped: ${totalFailed}`);
  console.log('========================================\n');

  // Get final count
  const countResult = await pool.query('SELECT COUNT(*) FROM nutrition_foods');
  console.log(`Total foods in database: ${countResult.rows[0].count}`);

  await pool.end();
}

// Run the seeder
seedUSDAFoods().catch(console.error);
