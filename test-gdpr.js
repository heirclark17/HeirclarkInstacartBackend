const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function testExport() {
  const userId = '9333014135091';

  try {
    console.log('Testing full export query flow...');

    // 1. User Preferences
    console.log('\n1. Preferences:');
    const prefs = await pool.query(`
      SELECT goal_weight_lbs, hydration_target_ml, calories_target,
             protein_target, carbs_target, fat_target, timezone,
             pii_enc, created_at, updated_at
      FROM hc_user_preferences
      WHERE shopify_customer_id = $1
    `, [userId]);
    console.log('   Rows:', prefs.rows.length);

    // 2. Health Metrics
    console.log('\n2. Health Metrics:');
    const health = await pool.query(`
      SELECT ts, steps, active_calories, resting_energy, latest_heart_rate_bpm,
             workouts_today, source, metrics_enc, received_at
      FROM hc_health_latest
      WHERE shopify_customer_id = $1
    `, [userId]);
    console.log('   Rows:', health.rows.length);
    if (health.rows.length > 0) {
      console.log('   Data:', JSON.stringify(health.rows[0]).substring(0, 200));
    }

    // 3. Daily history
    console.log('\n3. Daily History:');
    const daily = await pool.query(`
      SELECT date, burned_kcal, consumed_kcal, last_updated_at
      FROM hc_apple_health_daily
      WHERE shopify_customer_id = $1
      ORDER BY date DESC
    `, [userId]);
    console.log('   Rows:', daily.rows.length);

    // 4. Meals
    console.log('\n4. Meals:');
    const meals = await pool.query(`
      SELECT id, datetime, label, items, items_enc, total_calories,
             total_protein, total_carbs, total_fat, source, created_at
      FROM hc_meals
      WHERE shopify_customer_id = $1
      ORDER BY datetime DESC
    `, [userId]);
    console.log('   Rows:', meals.rows.length);

    // 5. Weight
    console.log('\n5. Weight:');
    const weight = await pool.query(`
      SELECT id, date, weight_lbs, weight_enc, created_at
      FROM hc_weight_logs
      WHERE shopify_customer_id = $1
      ORDER BY date DESC
    `, [userId]);
    console.log('   Rows:', weight.rows.length);

    // 6. Hydration
    console.log('\n6. Hydration:');
    const water = await pool.query(`
      SELECT id, datetime, amount_ml, created_at
      FROM hc_water_logs
      WHERE shopify_customer_id = $1
      ORDER BY datetime DESC
    `, [userId]);
    console.log('   Rows:', water.rows.length);

    // 7. Videos
    console.log('\n7. Videos:');
    const videos = await pool.query(`
      SELECT id, heygen_video_id, video_url, status, created_at, expires_at
      FROM hc_user_videos
      WHERE user_id = $1
      ORDER BY created_at DESC
    `, [userId]);
    console.log('   Rows:', videos.rows.length);

    // 8. Devices
    console.log('\n8. Devices:');
    const devices = await pool.query(`
      SELECT id, device_key, device_name, created_at, last_seen_at
      FROM hc_health_devices
      WHERE shopify_customer_id = $1
    `, [userId]);
    console.log('   Rows:', devices.rows.length);

    // 9. Wearables
    console.log('\n9. Wearables:');
    const wearables = await pool.query(`
      SELECT provider, token_type, scope, expires_at, created_at, updated_at
      FROM wearable_tokens
      WHERE customer_id = $1
    `, [userId]);
    console.log('   Rows:', wearables.rows.length);

    // 10. Audit
    console.log('\n10. Audit:');
    const audit = await pool.query(`
      SELECT timestamp, action, resource_type, request_method, request_path
      FROM audit_logs
      WHERE user_id = $1
      AND timestamp > NOW() - INTERVAL '30 days'
      ORDER BY timestamp DESC
      LIMIT 100
    `, [userId]);
    console.log('   Rows:', audit.rows.length);

    console.log('\n✅ All queries passed!');
  } catch (err) {
    console.error('\n❌ Error:', err.message);
    console.error('Detail:', err);
  }

  await pool.end();
}

testExport();
