// Script to add is_favorite column to Railway database
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
});

async function addFavoriteColumn() {
  console.log('🔧 Adding is_favorite column to hc_meal_library table...\n');

  try {
    // Add the is_favorite column
    console.log('Step 1: Adding is_favorite column...');
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'hc_meal_library' AND column_name = 'is_favorite'
        ) THEN
          ALTER TABLE hc_meal_library ADD COLUMN is_favorite BOOLEAN DEFAULT FALSE;
          RAISE NOTICE 'Column is_favorite added successfully';
        ELSE
          RAISE NOTICE 'Column is_favorite already exists';
        END IF;
      END $$;
    `);
    console.log('✅ is_favorite column check complete\n');

    // Create the index
    console.log('Step 2: Creating index for favorites...');
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_meal_library_favorite
      ON hc_meal_library(shopify_customer_id, is_favorite);
    `);
    console.log('✅ Index created\n');

    // Verify the column was added
    console.log('Step 3: Verifying column...');
    const result = await pool.query(`
      SELECT column_name, data_type, column_default, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'hc_meal_library' AND column_name = 'is_favorite';
    `);

    if (result.rows.length > 0) {
      console.log('✅ Column verification successful:');
      console.log(result.rows[0]);
    } else {
      console.log('❌ Column not found after migration');
    }

    // Show table structure
    console.log('\nFull table structure:');
    const columns = await pool.query(`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns
      WHERE table_name = 'hc_meal_library'
      ORDER BY ordinal_position;
    `);
    console.table(columns.rows);

    console.log('\n✅ Migration complete!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration error:', err.message);
    console.error(err);
    process.exit(1);
  }
}

addFavoriteColumn();
