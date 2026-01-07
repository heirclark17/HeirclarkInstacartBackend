// scripts/run-menu-migration.ts
import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import 'dotenv/config';

const DATABASE_URL = process.env.DATABASE_URL || '';

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL is not set');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : undefined,
});

async function runMigration() {
  console.log('\n╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║          Running Restaurant Menu Cache Migration                  ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

  try {
    // Read migration file
    const migrationPath = path.join(__dirname, '../src/db/migrations/006-restaurant-menu-cache.sql');
    const migration = fs.readFileSync(migrationPath, 'utf8');

    console.log('📖 Running migration...');
    await pool.query(migration);
    console.log('✅ Migration completed successfully!\n');

    // Now seed with existing hardcoded data
    console.log('📦 Seeding existing restaurant data...\n');

    const restaurants = [
      {
        id: 'chipotle',
        name: 'Chipotle',
        items: [
          { name: 'Chicken Burrito Bowl', category: 'bowls', calories: 665, protein: 53, carbs: 55, fat: 24, customizable: true },
          { name: 'Steak Burrito Bowl', category: 'bowls', calories: 700, protein: 51, carbs: 55, fat: 28, customizable: true },
          { name: 'Chicken Salad', category: 'salads', calories: 480, protein: 45, carbs: 20, fat: 28, customizable: true },
          { name: 'Veggie Bowl', category: 'bowls', calories: 550, protein: 15, carbs: 72, fat: 22, customizable: true },
        ]
      },
      {
        id: 'chickfila',
        name: 'Chick-fil-A',
        items: [
          { name: 'Grilled Chicken Sandwich', category: 'sandwiches', calories: 380, protein: 28, carbs: 44, fat: 6, customizable: false },
          { name: 'Chicken Nuggets (12-count)', category: 'entrees', calories: 380, protein: 40, carbs: 16, fat: 17, customizable: false },
          { name: 'Spicy Southwest Salad', category: 'salads', calories: 450, protein: 33, carbs: 28, fat: 23, customizable: true },
          { name: 'Grilled Chicken Cool Wrap', category: 'wraps', calories: 350, protein: 37, carbs: 29, fat: 13, customizable: false },
          { name: 'Chicken Sandwich', category: 'sandwiches', calories: 440, protein: 28, carbs: 41, fat: 17, customizable: false },
          { name: 'Cobb Salad', category: 'salads', calories: 510, protein: 40, carbs: 27, fat: 28, customizable: true },
          { name: 'Waffle Potato Fries (Medium)', category: 'sides', calories: 360, protein: 5, carbs: 43, fat: 18, customizable: false },
          { name: 'Hash Browns', category: 'breakfast', calories: 270, protein: 3, carbs: 25, fat: 18, customizable: false },
        ]
      },
      {
        id: 'panera',
        name: 'Panera Bread',
        items: [
          { name: 'Mediterranean Bowl with Chicken', category: 'bowls', calories: 520, protein: 35, carbs: 40, fat: 25, customizable: false },
          { name: 'Asian Sesame Salad with Chicken', category: 'salads', calories: 400, protein: 30, carbs: 32, fat: 18, customizable: false },
          { name: 'Turkey Avocado BLT', category: 'sandwiches', calories: 620, protein: 38, carbs: 50, fat: 32, customizable: false },
          { name: 'Greek Salad with Chicken', category: 'salads', calories: 380, protein: 32, carbs: 15, fat: 23, customizable: false },
        ]
      },
      {
        id: 'sweetgreen',
        name: 'Sweetgreen',
        items: [
          { name: 'Harvest Bowl', category: 'bowls', calories: 555, protein: 23, carbs: 48, fat: 33, customizable: false },
          { name: 'Chicken Pesto Parm', category: 'bowls', calories: 630, protein: 42, carbs: 44, fat: 34, customizable: false },
          { name: 'Kale Caesar', category: 'salads', calories: 450, protein: 28, carbs: 25, fat: 30, customizable: false },
          { name: 'Super Green Goddess', category: 'salads', calories: 310, protein: 9, carbs: 38, fat: 14, customizable: false },
        ]
      },
      {
        id: 'subway',
        name: 'Subway',
        items: [
          { name: "6\" Turkey Breast", category: "sandwiches", calories: 280, protein: 18, carbs: 46, fat: 3.5, customizable: true },
          { name: "6\" Chicken & Bacon Ranch", category: "sandwiches", calories: 530, protein: 36, carbs: 45, fat: 24, customizable: true },
          { name: "6\" Veggie Delite", category: "sandwiches", calories: 230, protein: 8, carbs: 44, fat: 2.5, customizable: true },
          { name: "Rotisserie Chicken Salad", category: "salads", calories: 350, protein: 29, carbs: 11, fat: 22, customizable: true },
          { name: "6\" Steak & Cheese", category: "sandwiches", calories: 380, protein: 23, carbs: 48, fat: 10, customizable: true },
          { name: "6\" Tuna", category: "sandwiches", calories: 470, protein: 20, carbs: 45, fat: 23, customizable: true },
          { name: "Egg & Cheese Wrap", category: "breakfast", calories: 390, protein: 19, carbs: 38, fat: 17, customizable: true },
          { name: "6\" Sweet Onion Chicken Teriyaki", category: "sandwiches", calories: 370, protein: 25, carbs: 57, fat: 4.5, customizable: true },
        ]
      },
      {
        id: 'mcdonalds',
        name: "McDonald's",
        items: [
          { name: "Big Mac", category: "burgers", calories: 550, protein: 25, carbs: 45, fat: 30, customizable: false },
          { name: "Quarter Pounder with Cheese", category: "burgers", calories: 520, protein: 26, carbs: 42, fat: 26, customizable: false },
          { name: "10-Piece Chicken McNuggets", category: "chicken", calories: 420, protein: 23, carbs: 25, fat: 24, customizable: false },
          { name: "Premium Southwest Salad (Grilled)", category: "salads", calories: 350, protein: 37, carbs: 27, fat: 12, customizable: true },
          { name: "Artisan Grilled Chicken Sandwich", category: "chicken", calories: 380, protein: 37, carbs: 44, fat: 7, customizable: false },
          { name: "Filet-O-Fish", category: "fish", calories: 380, protein: 15, carbs: 39, fat: 18, customizable: false },
          { name: "Egg McMuffin", category: "breakfast", calories: 300, protein: 17, carbs: 30, fat: 13, customizable: false },
          { name: "Fruit & Maple Oatmeal", category: "breakfast", calories: 320, protein: 6, carbs: 64, fat: 4.5, customizable: false },
        ]
      },
      {
        id: 'wendys',
        name: "Wendy's",
        items: [
          { name: "Dave's Single", category: "burgers", calories: 570, protein: 29, carbs: 41, fat: 34, customizable: true },
          { name: "Grilled Chicken Sandwich", category: "chicken", calories: 370, protein: 34, carbs: 37, fat: 10, customizable: false },
          { name: "Spicy Chicken Sandwich", category: "chicken", calories: 490, protein: 29, carbs: 48, fat: 20, customizable: false },
          { name: "Southwest Avocado Chicken Salad", category: "salads", calories: 520, protein: 33, carbs: 31, fat: 31, customizable: true },
          { name: "Apple Pecan Chicken Salad", category: "salads", calories: 560, protein: 34, carbs: 39, fat: 30, customizable: true },
          { name: "Homestyle Chicken Go Wrap (Grilled)", category: "wraps", calories: 270, protein: 18, carbs: 25, fat: 10, customizable: false },
          { name: "Jr. Bacon Cheeseburger", category: "burgers", calories: 370, protein: 19, carbs: 26, fat: 21, customizable: true },
          { name: "Chili (Small)", category: "sides", calories: 250, protein: 17, carbs: 23, fat: 9, customizable: false },
        ]
      },
      {
        id: 'tacobell',
        name: 'Taco Bell',
        items: [
          { name: "Chicken Power Bowl", category: "bowls", calories: 470, protein: 26, carbs: 50, fat: 17, customizable: true },
          { name: "Chicken Soft Taco", category: "tacos", calories: 160, protein: 12, carbs: 15, fat: 5, customizable: true },
          { name: "Crunchy Taco", category: "tacos", calories: 170, protein: 8, carbs: 13, fat: 10, customizable: true },
          { name: "Chicken Burrito", category: "burritos", calories: 350, protein: 13, carbs: 48, fat: 11, customizable: true },
          { name: "Grilled Steak Soft Taco", category: "tacos", calories: 180, protein: 12, carbs: 17, fat: 6, customizable: true },
          { name: "Black Beans & Rice", category: "sides", calories: 180, protein: 5, carbs: 33, fat: 3.5, customizable: false },
          { name: "Veggie Power Bowl", category: "bowls", calories: 450, protein: 13, carbs: 62, fat: 16, customizable: true },
          { name: "Breakfast Crunchwrap (Steak)", category: "breakfast", calories: 680, protein: 21, carbs: 71, fat: 35, customizable: true },
        ]
      }
    ];

    let totalInserted = 0;

    for (const restaurant of restaurants) {
      console.log(`📋 Seeding ${restaurant.name}...`);

      for (const item of restaurant.items) {
        try {
          await pool.query(
            `INSERT INTO restaurant_menu_items
             (restaurant_id, restaurant_name, name, category, calories, protein, carbs, fat, customizable, source, confidence_score)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'manual', 100)
             ON CONFLICT (restaurant_id, name) DO NOTHING`,
            [
              restaurant.id,
              restaurant.name,
              item.name,
              item.category,
              item.calories,
              item.protein,
              item.carbs,
              item.fat,
              item.customizable
            ]
          );
          totalInserted++;
        } catch (err: any) {
          console.error(`   ❌ Error inserting ${item.name}:`, err.message);
        }
      }

      console.log(`   ✅ ${restaurant.name} seeded with ${restaurant.items.length} items`);
    }

    console.log(`\n✅ Total items inserted: ${totalInserted}\n`);

    // Show summary
    const summary = await pool.query(`
      SELECT
        restaurant_name,
        total_items,
        ai_generated_items,
        manual_items
      FROM restaurant_metadata
      ORDER BY restaurant_name
    `);

    console.log('📊 Restaurant Menu Summary:\n');
    summary.rows.forEach(row => {
      console.log(`   ${row.restaurant_name.padEnd(20)} → ${row.total_items} items (${row.manual_items} manual, ${row.ai_generated_items} AI)`);
    });

    console.log('\n╔═══════════════════════════════════════════════════════════════════╗');
    console.log('║                        ✅ COMPLETE!                               ║');
    console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

  } catch (error: any) {
    console.error('\n❌ Migration failed:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();
