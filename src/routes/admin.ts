// src/routes/admin.ts
// Admin endpoints for database management tasks

import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import axios from 'axios';

const USDA_API_KEY = process.env.USDA_API_KEY || 'DEMO_KEY';
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'heirclark-admin-2024';
const USDA_BASE_URL = 'https://api.nal.usda.gov/fdc/v1';

// Nutrient IDs from USDA
const NUTRIENT_IDS = {
  calories: 1008,
  protein: 1003,
  fat: 1004,
  carbs: 1005,
  fiber: 1079,
  sugar: 2000,
  sodium: 1093,
  cholesterol: 1253,
  saturated_fat: 1258,
  potassium: 1092,
  vitamin_a: 1106,
  vitamin_c: 1162,
  calcium: 1087,
  iron: 1089,
};

export function createAdminRouter(pool: Pool): Router {
  const router = Router();

  // Middleware to check admin secret
  const checkAdminAuth = (req: Request, res: Response, next: Function) => {
    const secret = req.headers['x-admin-secret'] || req.query.secret;
    if (secret !== ADMIN_SECRET) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    next();
  };

  // GET /api/v1/admin/stats
  router.get('/stats', checkAdminAuth, async (req: Request, res: Response) => {
    try {
      // ✅ SECURITY FIX: SQL Injection Prevention (OWASP A03)
      // Use allowlist validation for table names (PostgreSQL doesn't support parameterized table names)
      const ALLOWED_TABLES = new Set([
        'nutrition_foods',
        'hc_programs',
        'hc_tasks',
        'hc_program_enrollments',
        'hc_user_profiles',
        'hc_challenges',
        'hc_progress_photos',
        'hc_import_jobs',
      ]);

      const tables = Array.from(ALLOWED_TABLES);
      const stats: Record<string, number> = {};

      for (const table of tables) {
        // Validate table name against allowlist before querying
        if (!ALLOWED_TABLES.has(table)) {
          console.error(`[Admin] Invalid table name rejected: ${table}`);
          continue;
        }

        try {
          const result = await pool.query(`SELECT COUNT(*) FROM ${table}`);
          stats[table] = parseInt(result.rows[0].count);
        } catch {
          stats[table] = -1; // Table doesn't exist
        }
      }

      return res.json({ ok: true, data: stats });
    } catch (error) {
      console.error('[Admin] Stats error:', error);
      return res.status(500).json({ ok: false, error: 'Failed to get stats' });
    }
  });

  // POST /api/v1/admin/seed-usda
  router.post('/seed-usda', checkAdminAuth, async (req: Request, res: Response) => {
    const { pages = 10, dataType = 'Foundation' } = req.body;

    // Send immediate response, run seeding in background
    res.json({
      ok: true,
      message: `Starting USDA seeding in background (${dataType}, ${pages} pages)`,
    });

    // Run seeding in background
    seedUSDAFoodsBackground(pool, dataType, pages).catch(console.error);
  });

  // POST /api/v1/admin/migrate-programs
  // Add missing columns for programs and create tasks table
  router.post('/migrate-programs', checkAdminAuth, async (req: Request, res: Response) => {
    try {
      console.log('[Admin] Running programs migration...');

      // Add missing columns to hc_programs
      await pool.query(`
        ALTER TABLE hc_programs ADD COLUMN IF NOT EXISTS slug VARCHAR(100) UNIQUE;
        ALTER TABLE hc_programs ADD COLUMN IF NOT EXISTS is_default_onboarding BOOLEAN DEFAULT false;
        ALTER TABLE hc_programs ADD COLUMN IF NOT EXISTS target_audience JSONB DEFAULT '[]'::jsonb;
        ALTER TABLE hc_programs ADD COLUMN IF NOT EXISTS prerequisites JSONB DEFAULT '[]'::jsonb;
        ALTER TABLE hc_programs ADD COLUMN IF NOT EXISTS learning_objectives JSONB DEFAULT '[]'::jsonb;
        ALTER TABLE hc_programs ADD COLUMN IF NOT EXISTS methodology VARCHAR(50);
      `);

      // Create hc_tasks table if not exists
      await pool.query(`
        CREATE TABLE IF NOT EXISTS hc_tasks (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          program_id UUID NOT NULL REFERENCES hc_programs(id) ON DELETE CASCADE,
          task_order INTEGER NOT NULL,
          day_number INTEGER NOT NULL,
          task_type VARCHAR(50) NOT NULL CHECK (task_type IN ('lesson', 'action', 'reflection', 'quiz')),
          title VARCHAR(255) NOT NULL,
          content TEXT NOT NULL,
          points_value INTEGER DEFAULT 10,
          action_type VARCHAR(50),
          quiz_questions JSONB,
          estimated_minutes INTEGER DEFAULT 5,
          created_at TIMESTAMPTZ DEFAULT NOW(),

          UNIQUE(program_id, task_order)
        );

        CREATE INDEX IF NOT EXISTS idx_tasks_program ON hc_tasks(program_id);
        CREATE INDEX IF NOT EXISTS idx_tasks_day ON hc_tasks(program_id, day_number);
      `);

      // Ensure hc_program_task_responses has all needed columns
      // (Most should exist from original migration, but ensure points_awarded exists)
      await pool.query(`
        ALTER TABLE hc_program_task_responses ADD COLUMN IF NOT EXISTS points_awarded INTEGER DEFAULT 0;
      `);

      // Add last_activity_date for streak tracking
      await pool.query(`
        ALTER TABLE hc_program_enrollments ADD COLUMN IF NOT EXISTS last_activity_date DATE;
      `);

      console.log('[Admin] Programs migration complete');

      return res.json({
        ok: true,
        message: 'Migration complete',
      });
    } catch (error: any) {
      console.error('[Admin] Migration error:', error);
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  // POST /api/v1/admin/seed-onboarding
  // Seed the 7-day onboarding program
  router.post('/seed-onboarding', checkAdminAuth, async (req: Request, res: Response) => {
    try {
      console.log('[Admin] Starting onboarding program seeding...');
      const result = await seedOnboardingProgram(pool);
      return res.json({
        ok: true,
        data: result,
      });
    } catch (error: any) {
      console.error('[Admin] Onboarding seed error:', error);
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  // POST /api/v1/admin/seed-usda-sync (synchronous, for small batches)
  router.post('/seed-usda-sync', checkAdminAuth, async (req: Request, res: Response) => {
    try {
      const { pages = 5, dataType = 'Foundation' } = req.body;

      console.log(`[Admin] Starting synchronous USDA seeding: ${dataType}, ${pages} pages`);

      let totalInserted = 0;

      for (let page = 1; page <= pages; page++) {
        const foods = await fetchUSDAFoods(dataType, 200, page);
        if (foods.length === 0) break;

        console.log(`[Admin] Processing page ${page}: ${foods.length} foods`);

        for (const food of foods) {
          const mapped = mapUSDAToNutritionFood(food);
          const success = await insertFood(pool, mapped);
          if (success) totalInserted++;
        }

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      // Get total count
      const countResult = await pool.query('SELECT COUNT(*) FROM nutrition_foods');

      return res.json({
        ok: true,
        data: {
          inserted: totalInserted,
          total_foods: parseInt(countResult.rows[0].count),
        },
      });
    } catch (error: any) {
      console.error('[Admin] Seed error:', error);
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  return router;
}

// Helper functions
async function fetchUSDAFoods(dataType: string, pageSize: number, pageNumber: number): Promise<any[]> {
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
      { headers: { 'Content-Type': 'application/json' } }
    );
    return response.data.foods || [];
  } catch (error: any) {
    console.error(`Error fetching USDA foods:`, error.message);
    return [];
  }
}

function getNutrientValue(food: any, nutrientId: number): number | null {
  const nutrient = food.foodNutrients?.find((n: any) => n.nutrientId === nutrientId);
  return nutrient ? nutrient.value : null;
}

function mapUSDAToNutritionFood(food: any) {
  const calories = getNutrientValue(food, NUTRIENT_IDS.calories) || 0;
  const protein = getNutrientValue(food, NUTRIENT_IDS.protein) || 0;
  const carbs = getNutrientValue(food, NUTRIENT_IDS.carbs) || 0;

  const dietaryFlags: string[] = [];
  if (protein >= 20) dietaryFlags.push('high_protein');
  const sodium = getNutrientValue(food, NUTRIENT_IDS.sodium);
  if (sodium && sodium < 140) dietaryFlags.push('low_sodium');
  if (carbs < 5 && calories > 0) dietaryFlags.push('keto_friendly');

  return {
    name: food.description,
    brand: food.brandOwner || food.brandName || null,
    category: food.foodCategory || null,
    upc: food.gtinUpc || null,
    calories,
    protein_g: protein,
    carbs_g: carbs,
    fat_g: getNutrientValue(food, NUTRIENT_IDS.fat) || 0,
    fiber_g: getNutrientValue(food, NUTRIENT_IDS.fiber),
    sugar_g: getNutrientValue(food, NUTRIENT_IDS.sugar),
    sodium_mg: sodium,
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
    quality_score: 85,
    source: 'usda',
    source_id: food.fdcId?.toString(),
    dietary_flags: dietaryFlags,
  };
}

async function insertFood(pool: Pool, food: any): Promise<boolean> {
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
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18,
        $19, $20, $21, $22, $23, $24, $25, $26, $27
      )
      ON CONFLICT (upc) DO UPDATE SET
        name = EXCLUDED.name,
        calories = EXCLUDED.calories,
        protein_g = EXCLUDED.protein_g,
        updated_at = NOW()
      WHERE nutrition_foods.upc IS NOT NULL`,
      [
        food.name, food.brand, food.category, food.upc,
        food.calories, food.protein_g, food.carbs_g, food.fat_g,
        food.fiber_g, food.sugar_g, food.sodium_mg, food.cholesterol_mg,
        food.saturated_fat_g, food.potassium_mg, food.vitamin_a_iu,
        food.vitamin_c_mg, food.calcium_mg, food.iron_mg,
        food.serving_amount, food.serving_unit, food.serving_grams,
        food.serving_description, food.verification_status, food.quality_score,
        food.source, food.source_id, JSON.stringify(food.dietary_flags),
      ]
    );
    return true;
  } catch {
    return false;
  }
}

async function seedUSDAFoodsBackground(pool: Pool, dataType: string, maxPages: number) {
  console.log(`[Admin] Background seeding started: ${dataType}`);
  let totalInserted = 0;

  for (let page = 1; page <= maxPages; page++) {
    const foods = await fetchUSDAFoods(dataType, 200, page);
    if (foods.length === 0) break;

    for (const food of foods) {
      const mapped = mapUSDAToNutritionFood(food);
      if (await insertFood(pool, mapped)) totalInserted++;
    }

    console.log(`[Admin] Page ${page} complete: ${totalInserted} total inserted`);
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log(`[Admin] Background seeding complete: ${totalInserted} foods inserted`);
}

// ==========================================================================
// Onboarding Program Seeder
// ==========================================================================
async function seedOnboardingProgram(pool: Pool): Promise<{ program_id: string; tasks_created: number }> {
  // First, check if ANY onboarding program already exists (by type OR slug)
  const existingProgram = await pool.query(
    `SELECT id FROM hc_programs WHERE type = 'onboarding' OR slug = 'nutrition-foundations-7day' LIMIT 1`
  );

  if (existingProgram.rows.length > 0) {
    const programId = existingProgram.rows[0].id;
    console.log(`[Admin] Found existing onboarding program: ${programId}`);

    // Check if there are any enrollments
    const enrollments = await pool.query(
      `SELECT COUNT(*) FROM hc_program_enrollments WHERE program_id = $1`,
      [programId]
    );

    const enrollmentCount = parseInt(enrollments.rows[0].count);
    console.log(`[Admin] Program has ${enrollmentCount} enrollments`);

    if (enrollmentCount > 0) {
      // Update existing program and tasks instead of deleting
      console.log('[Admin] Program has enrollments, updating existing tasks...');
      await pool.query(`DELETE FROM hc_tasks WHERE program_id = $1`, [programId]);
      // Seed tasks for the existing program
      return await updateAndSeedTasks(pool, programId);
    }

    // No enrollments, safe to delete and recreate
    await pool.query(`DELETE FROM hc_tasks WHERE program_id = $1`, [programId]);
    await pool.query(`DELETE FROM hc_programs WHERE id = $1`, [programId]);
    console.log('[Admin] Deleted existing onboarding program for reseed');
  }

  // Create the program
  const programResult = await pool.query(`
    INSERT INTO hc_programs (
      type, name, slug, description, category, difficulty, duration_days,
      is_default_onboarding, is_active, target_audience, prerequisites,
      learning_objectives, methodology, estimated_daily_minutes
    ) VALUES (
      'onboarding',
      'Nutrition Foundations: 7-Day Kickstart',
      'nutrition-foundations-7day',
      'Master the fundamentals of nutrition tracking in just 7 days. This science-backed program uses cognitive behavioral techniques to build lasting habits around food awareness, protein optimization, and mindful eating.',
      'onboarding',
      'beginner',
      7,
      true,
      true,
      '["new_users", "beginners", "habit_builders"]',
      '[]',
      '["Understand macronutrients and their role in body composition", "Build consistent tracking habits using the Habit Loop model", "Learn to identify protein-rich foods and hit daily targets", "Develop mindful eating practices", "Create sustainable meal planning strategies"]',
      'cbt_based',
      15
    ) RETURNING id
  `);

  const programId = programResult.rows[0].id;
  let taskOrder = 1;

  // Day 1: Welcome & First Log
  await insertTask(pool, programId, taskOrder++, 1, 'lesson', 'Welcome to Your Nutrition Journey', `
# Welcome to Nutrition Foundations

You're about to transform your relationship with food. Over the next 7 days, you'll build habits that elite athletes and nutrition experts use every day.

## Why Tracking Matters

Research shows that people who track their food intake are **2x more likely** to reach their health goals. But here's the secret: it's not about perfection—it's about awareness.

## The Habit Loop

Everything we do follows a simple pattern:
1. **Cue** - A trigger that initiates the behavior
2. **Routine** - The behavior itself
3. **Reward** - The benefit you receive

This week, we'll use this loop to make tracking automatic.

## What You'll Learn

- Day 1-2: Tracking basics & protein power
- Day 3-4: Understanding calories & building habits
- Day 5-6: Mindful eating & meal planning
- Day 7: Putting it all together

Let's begin!
  `, 10);

  await insertTask(pool, programId, taskOrder++, 1, 'action', 'Log Your First Meal', `
Time for action! Open the food logger and record what you ate for your most recent meal.

**Don't worry about:**
- Being perfect
- Exact portions
- Missing items

**Do focus on:**
- Getting something logged
- Noticing how it feels
- Completing the action

This is your first step. Every expert was once a beginner.
  `, 20, 'log_food');

  await insertTask(pool, programId, taskOrder++, 1, 'reflection', 'Notice Your Thoughts', `
Take a moment to reflect on your first logging experience.

**Consider:**
- What was easy about logging?
- What felt challenging?
- Did any thoughts or feelings come up?

There are no wrong answers. This reflection helps you understand your relationship with food tracking.
  `, 10, 'journal');

  await insertTask(pool, programId, taskOrder++, 1, 'quiz', 'Day 1 Check-In', `
Let's make sure you've got the basics down.
  `, 15, 'quiz', JSON.stringify([
    { q: 'What are the three parts of the Habit Loop?', a: ['Cue, Routine, Reward', 'Start, Middle, End', 'Think, Act, Feel', 'Plan, Do, Review'], correct: 0 },
    { q: 'What is the main goal of food tracking?', a: ['Counting every calorie perfectly', 'Building awareness of what you eat', 'Restricting food intake', 'Comparing yourself to others'], correct: 1 }
  ]));

  // Day 2: The Power of Protein
  await insertTask(pool, programId, taskOrder++, 2, 'lesson', 'The Power of Protein', `
# Protein: Your Body's Building Block

Today we focus on the most important macronutrient for body composition: **protein**.

## Why Protein Matters

- **Builds & repairs muscle** - Essential for recovery
- **Keeps you full longer** - Reduces cravings
- **Burns more calories** - Higher thermic effect
- **Preserves muscle during fat loss** - Protects your metabolism

## How Much Do You Need?

A good starting target:
- **0.7-1g per pound** of body weight
- Or **1.6-2.2g per kg** of body weight

For a 150lb person, that's 105-150g of protein daily.

## Protein-Rich Foods

| Food | Protein |
|------|---------|
| Chicken breast (4oz) | 35g |
| Greek yogurt (1 cup) | 20g |
| Eggs (2 large) | 12g |
| Salmon (4oz) | 25g |
| Tofu (1/2 cup) | 10g |
| Lentils (1 cup) | 18g |

## Today's Mission

Pay attention to protein in everything you eat. Start building awareness of where your protein comes from.
  `, 15);

  await insertTask(pool, programId, taskOrder++, 2, 'action', 'Track Protein All Day', `
Your mission today: Log every meal and snack, paying special attention to protein content.

**Track at least 3 meals/snacks** and aim to identify the protein source in each one.

Use the food search to find accurate protein values. Notice which foods are surprisingly high or low in protein.
  `, 25, 'log_food_protein');

  await insertTask(pool, programId, taskOrder++, 2, 'reflection', 'Protein Patterns', `
Review your protein intake from today.

**Reflect on:**
- How close did you get to your protein target?
- Which meal had the most protein?
- What could you add to boost protein tomorrow?
- Were there any surprises in protein content?
  `, 10, 'journal');

  await insertTask(pool, programId, taskOrder++, 2, 'quiz', 'Protein Knowledge Check', `
Test your protein knowledge!
  `, 15, 'quiz', JSON.stringify([
    { q: 'How much protein should you aim for per pound of body weight?', a: ['0.3-0.5g', '0.7-1g', '1.5-2g', '2.5-3g'], correct: 1 },
    { q: 'Which has MORE protein?', a: ['1 cup rice', '1 cup Greek yogurt', '1 banana', '1 slice bread'], correct: 1 },
    { q: 'What is NOT a benefit of adequate protein?', a: ['Builds muscle', 'Increases energy immediately', 'Keeps you full', 'Burns more calories'], correct: 1 }
  ]));

  // Day 3: Calories & Energy Balance
  await insertTask(pool, programId, taskOrder++, 3, 'lesson', 'Understanding Calories', `
# Calories: The Energy Equation

Today we demystify calories—the unit of energy that fuels everything you do.

## The Basic Equation

**Calories In vs Calories Out**

- **Eat more than you burn** → Weight gain
- **Eat less than you burn** → Weight loss
- **Eat what you burn** → Weight maintenance

## Your Daily Needs

Your Total Daily Energy Expenditure (TDEE) includes:

1. **BMR (60-70%)** - Calories burned at rest
2. **Activity (15-30%)** - Exercise and movement
3. **TEF (10%)** - Digesting food

Most people need **1,800-2,500 calories** daily, depending on size and activity.

## Quality Matters Too

Not all calories are equal for:
- **Satiety** - Protein and fiber keep you fuller
- **Energy** - Complex carbs provide steady fuel
- **Health** - Whole foods provide micronutrients

## The 80/20 Rule

Aim for **80% whole, nutritious foods** and allow **20% flexibility** for foods you enjoy. This sustainable approach beats strict dieting every time.
  `, 15);

  await insertTask(pool, programId, taskOrder++, 3, 'action', 'Full Day Tracking', `
Today, log EVERYTHING you eat and drink.

**Include:**
- All meals
- Snacks
- Beverages (yes, that coffee creamer counts!)
- Cooking oils and condiments

At the end of the day, review your total calories. No judgment—just data.
  `, 30, 'log_food_calories');

  await insertTask(pool, programId, taskOrder++, 3, 'reflection', 'Calorie Awareness', `
Look at your full day of tracking.

**Consider:**
- Were your total calories higher or lower than expected?
- Which foods contributed the most calories?
- Were there any "hidden" calories you discovered?
- How did your energy levels relate to what you ate?
  `, 10, 'journal');

  await insertTask(pool, programId, taskOrder++, 3, 'quiz', 'Energy Balance Quiz', `
Check your understanding of calories and energy.
  `, 15, 'quiz', JSON.stringify([
    { q: 'What makes up the largest portion of daily calorie burn?', a: ['Exercise', 'BMR (resting metabolism)', 'Digesting food', 'Walking'], correct: 1 },
    { q: 'The 80/20 rule suggests:', a: ['Eat 80% protein', '80% whole foods, 20% flexible', 'Exercise 80 minutes daily', 'Sleep 80% of the night'], correct: 1 }
  ]));

  // Day 4: Making It Automatic
  await insertTask(pool, programId, taskOrder++, 4, 'lesson', 'Building Lasting Habits', `
# Making Tracking Automatic

You've been tracking for 3 days. Now let's make it stick forever.

## The Science of Habit Formation

Research shows habits form through **consistent repetition** in a **stable context**. The key ingredients:

### 1. Same Time, Same Place
Link tracking to an existing routine:
- After you finish eating
- When you sit down at your desk
- Before you leave the kitchen

### 2. Make It Easy
- Keep the app on your home screen
- Use the barcode scanner
- Save frequent meals

### 3. Start Small
A 2-minute tracking session beats a skipped day. Progress over perfection.

## Habit Stacking

Attach tracking to something you already do:

> "After I [EXISTING HABIT], I will [LOG MY FOOD]."

Examples:
- "After I put my fork down, I will log my meal."
- "After I pour my morning coffee, I will log breakfast."

## The 21-Day Myth

Habits don't form in 21 days. Research shows it takes **66 days on average**. But here's the good news: missing one day doesn't reset your progress. It's about the overall pattern.
  `, 15);

  await insertTask(pool, programId, taskOrder++, 4, 'action', 'Create Your Habit Stack', `
Define your personal tracking trigger.

**Your task:**
1. Choose an existing daily habit (e.g., finishing a meal, morning coffee)
2. Create your habit stack statement
3. Write it down or set a phone reminder
4. Practice it today with every meal

**Format:** "After I _______, I will log my food."
  `, 20, 'habit_stack');

  await insertTask(pool, programId, taskOrder++, 4, 'reflection', 'Habit Formation', `
Reflect on building your tracking habit.

**Consider:**
- What habit trigger did you choose?
- How did using the trigger feel?
- What obstacles might get in your way?
- How will you overcome those obstacles?
  `, 10, 'journal');

  await insertTask(pool, programId, taskOrder++, 4, 'quiz', 'Habit Science Quiz', `
Test your knowledge of habit formation.
  `, 15, 'quiz', JSON.stringify([
    { q: 'How long does it actually take to form a habit on average?', a: ['21 days', '7 days', '66 days', '1 year'], correct: 2 },
    { q: 'What is habit stacking?', a: ['Doing multiple habits at once', 'Linking a new habit to an existing one', 'Tracking your habits', 'Breaking bad habits'], correct: 1 },
    { q: 'What should you do if you miss a day of tracking?', a: ['Start over from day 1', 'Give up entirely', 'Continue the next day', 'Track double the next day'], correct: 2 }
  ]));

  // Day 5: Beyond the Numbers
  await insertTask(pool, programId, taskOrder++, 5, 'lesson', 'The Mind-Body Connection', `
# Beyond the Numbers: Mindful Eating

Today we go deeper than macros. Let's explore how you **feel** about food.

## What is Mindful Eating?

Mindful eating means being fully present during meals:
- Noticing flavors, textures, aromas
- Recognizing hunger and fullness cues
- Eating without distraction
- Understanding emotional vs physical hunger

## The Hunger Scale

Rate your hunger from 1-10:

| Level | Description |
|-------|-------------|
| 1-2 | Starving, irritable |
| 3-4 | Very hungry, ready to eat |
| 5-6 | Satisfied, comfortable |
| 7-8 | Full, slightly uncomfortable |
| 9-10 | Stuffed, very uncomfortable |

**Ideal:** Start eating at 3-4, stop at 6-7.

## Emotional Eating Awareness

We often eat for reasons beyond hunger:
- Stress
- Boredom
- Celebration
- Habit

This isn't "bad"—it's human. Awareness is the first step.

## Today's Practice

Before each meal, pause for 30 seconds. Take three deep breaths. Ask yourself: "How hungry am I really?"
  `, 15);

  await insertTask(pool, programId, taskOrder++, 5, 'action', 'Mindful Meal Practice', `
Choose one meal today to eat mindfully.

**The practice:**
1. Remove distractions (phone, TV)
2. Take 3 deep breaths before eating
3. Rate your hunger (1-10)
4. Eat slowly, noticing each bite
5. Pause halfway through—rate fullness
6. Stop when satisfied (6-7 on scale)
7. Log the meal AND your hunger/fullness ratings
  `, 25, 'mindful_meal');

  await insertTask(pool, programId, taskOrder++, 5, 'reflection', 'Mind-Body Insights', `
Reflect on your mindful eating experience.

**Consider:**
- What did you notice when eating without distractions?
- Were you more or less hungry than you thought?
- Did you notice any emotions around food today?
- How might mindful eating change your relationship with food?
  `, 15, 'journal');

  await insertTask(pool, programId, taskOrder++, 5, 'quiz', 'Mindful Eating Check', `
Review what you've learned about mindful eating.
  `, 15, 'quiz', JSON.stringify([
    { q: 'What hunger level should you ideally start eating at?', a: ['1-2', '3-4', '7-8', '9-10'], correct: 1 },
    { q: 'What is emotional eating?', a: ['Eating when sad', 'Eating for reasons beyond physical hunger', 'Eating too much', 'Eating alone'], correct: 1 }
  ]));

  // Day 6: Set Yourself Up for Success
  await insertTask(pool, programId, taskOrder++, 6, 'lesson', 'Planning for Success', `
# Meal Planning: Your Secret Weapon

Planning ahead is how consistent trackers stay consistent. Today you'll learn strategies the pros use.

## Why Planning Works

- **Reduces decision fatigue** - Fewer choices = easier adherence
- **Improves accuracy** - Log before you eat
- **Saves money** - Less impulse buying
- **Hits targets** - Build meals around your goals

## The Pre-Log Strategy

Elite trackers often log meals **before** eating them. This lets you:
- Adjust portions to hit targets
- Swap ingredients if needed
- Make informed decisions

## Building a Template Day

Create a flexible template:

**Breakfast:** ~400 cal, 30g protein
**Lunch:** ~500 cal, 40g protein
**Dinner:** ~600 cal, 40g protein
**Snacks:** ~300 cal, 20g protein

Adjust based on your needs, but having a framework helps.

## The Power of Prep

Sunday prep ideas:
- Cook protein in bulk
- Wash and cut vegetables
- Portion snacks
- Prepare overnight oats

You don't need to meal prep everything—even small prep helps.
  `, 15);

  await insertTask(pool, programId, taskOrder++, 6, 'action', 'Plan Tomorrow\'s Meals', `
Pre-log tomorrow's meals right now.

**Your task:**
1. Open the food logger
2. Plan and log breakfast, lunch, dinner, and snacks for tomorrow
3. Check that you're hitting your protein target
4. Adjust as needed

Tomorrow, you'll follow this plan and see how it feels to eat with intention.
  `, 30, 'plan_meals');

  await insertTask(pool, programId, taskOrder++, 6, 'reflection', 'Planning Insights', `
Reflect on the meal planning process.

**Consider:**
- How did it feel to plan ahead?
- Did you discover any gaps (like low protein at breakfast)?
- What adjustments did you make?
- How confident do you feel about tomorrow?
  `, 10, 'journal');

  await insertTask(pool, programId, taskOrder++, 6, 'quiz', 'Planning Quiz', `
Check your meal planning knowledge.
  `, 15, 'quiz', JSON.stringify([
    { q: 'What is the "pre-log" strategy?', a: ['Logging yesterday\'s food', 'Logging food before you eat it', 'Logging only breakfast', 'Logging once a week'], correct: 1 },
    { q: 'What is a benefit of meal planning?', a: ['It\'s more fun', 'Reduces decision fatigue', 'Burns more calories', 'Requires less protein'], correct: 1 }
  ]));

  // Day 7: Celebration & Next Steps
  await insertTask(pool, programId, taskOrder++, 7, 'lesson', 'Celebration & Graduation', `
# Congratulations! You Did It!

You've completed 7 days of nutrition foundations. Take a moment to appreciate what you've accomplished.

## What You've Learned

✅ How to track food accurately
✅ The importance of protein
✅ Understanding calories and energy balance
✅ Building automatic habits
✅ Mindful eating practices
✅ Meal planning strategies

## Your New Skills

You now have the tools that elite athletes and nutrition coaches use daily. These aren't just "diet tricks"—they're lifelong skills.

## What's Next?

**Keep the momentum going:**

1. **Continue daily tracking** - Aim for 80% consistency
2. **Hit your protein target** - Make it a daily priority
3. **Weekly planning** - Spend 15 minutes on Sundays
4. **Monthly reflection** - Review your progress

## Remember

Progress isn't linear. Some days you'll nail it, others you won't. What matters is the overall trend. You've built a foundation—now keep building on it.

**You've got this.**
  `, 20);

  await insertTask(pool, programId, taskOrder++, 7, 'action', 'Log Your Final Day', `
Complete your 7th day of tracking.

Log all meals and snacks for today. This is your graduation day—show yourself what you've learned!
  `, 25, 'log_food');

  await insertTask(pool, programId, taskOrder++, 7, 'reflection', 'Your Journey', `
Final reflection: Look back on your week.

**Consider:**
- What was your biggest insight this week?
- Which day or lesson impacted you most?
- What habit will you definitely continue?
- What's one thing you want to improve?
- How do you feel about nutrition tracking now vs. Day 1?
  `, 20, 'journal');

  await insertTask(pool, programId, taskOrder++, 7, 'quiz', 'Graduation Quiz', `
Final quiz to cement your knowledge!
  `, 25, 'quiz', JSON.stringify([
    { q: 'What is the recommended protein intake per pound of body weight?', a: ['0.2-0.4g', '0.7-1g', '2-3g', '5g'], correct: 1 },
    { q: 'What are the three parts of the Habit Loop?', a: ['Think, Act, Sleep', 'Cue, Routine, Reward', 'Plan, Execute, Rest', 'Eat, Track, Repeat'], correct: 1 },
    { q: 'What hunger level should you stop eating at?', a: ['1-2', '3-4', '6-7', '9-10'], correct: 2 },
    { q: 'How long does habit formation typically take?', a: ['7 days', '21 days', '66 days', '1 year'], correct: 2 },
    { q: 'What is the 80/20 rule for nutrition?', a: ['80g protein, 20g fat', '80% whole foods, 20% flexible', '80 minutes exercise, 20 rest', '80 calories, 20 carbs'], correct: 1 }
  ]));

  // Get total tasks
  const taskCount = await pool.query(
    `SELECT COUNT(*) FROM hc_tasks WHERE program_id = $1`,
    [programId]
  );

  console.log(`[Admin] Onboarding program seeded: ${taskCount.rows[0].count} tasks`);

  return {
    program_id: programId,
    tasks_created: parseInt(taskCount.rows[0].count),
  };
}

// Helper to seed tasks for an existing program (when enrollments exist)
async function updateAndSeedTasks(pool: Pool, programId: string): Promise<{ program_id: string; tasks_created: number }> {
  let taskOrder = 1;

  // Day 1 Tasks
  await insertTask(pool, programId, taskOrder++, 1, 'lesson', 'Welcome to Your Nutrition Journey', `
# Welcome to Nutrition Foundations

You're about to transform your relationship with food. This science-backed program uses cognitive behavioral techniques to build lasting habits.

## Why Tracking Matters

Research shows that people who track their food intake are **2x more likely** to reach their health goals.

## This Week You'll Learn
- Protein optimization
- Calorie awareness
- Habit building
- Mindful eating
- Meal planning
  `, 10);

  await insertTask(pool, programId, taskOrder++, 1, 'action', 'Log Your First Meal', 'Record what you ate for your most recent meal.', 20, 'log_food');
  await insertTask(pool, programId, taskOrder++, 1, 'reflection', 'First Logging Reflection', 'What surprised you about logging your first meal?', 15);

  // Day 2 Tasks
  await insertTask(pool, programId, taskOrder++, 2, 'lesson', 'The Power of Protein', `
# Protein: Your Body's Building Block

Protein is the most important macronutrient for body transformation.

## Why Protein Matters
- Builds and repairs muscle tissue
- Keeps you feeling full longer
- Burns more calories during digestion
- Preserves muscle when losing weight

## How Much Do You Need?
**0.7-1g per pound of body weight** if you're active.
  `, 10);

  await insertTask(pool, programId, taskOrder++, 2, 'action', 'Log All Meals Today', 'Track everything you eat today and check your protein total.', 25, 'log_food');
  await insertTask(pool, programId, taskOrder++, 2, 'reflection', 'Protein Check-In', 'How much protein did you eat? Were you surprised?', 15);

  // Day 3 Tasks
  await insertTask(pool, programId, taskOrder++, 3, 'lesson', 'Understanding Calories', `
# Calories: The Energy Equation

- **Calories in < Calories out** = Weight loss
- **Calories in > Calories out** = Weight gain
- **Calories in = Calories out** = Maintenance

A sustainable deficit: 300-500 calories below maintenance = 1 pound lost per week.
  `, 10);

  await insertTask(pool, programId, taskOrder++, 3, 'action', 'Set Your Goals', 'Enter your weight, height, and activity level to get personalized targets.', 20, 'set_goals');
  await insertTask(pool, programId, taskOrder++, 3, 'reflection', 'Energy Awareness', 'How did your actual intake compare to your target?', 15);

  // Day 4 Tasks
  await insertTask(pool, programId, taskOrder++, 4, 'lesson', 'Building Habits', `
# The Habit Loop

Every habit has three parts:
1. **Cue** - The trigger
2. **Routine** - The behavior
3. **Reward** - The benefit

For tracking: Sitting down to eat (cue) → Log your meal (routine) → See your progress (reward)
  `, 10);

  await insertTask(pool, programId, taskOrder++, 4, 'action', 'Design Your Tracking Habit', 'Choose your cue, routine, and reward for food tracking.', 20, 'create_habit');
  await insertTask(pool, programId, taskOrder++, 4, 'reflection', 'Habit Design', 'What cue will trigger your tracking habit?', 15);

  // Day 5 Tasks
  await insertTask(pool, programId, taskOrder++, 5, 'lesson', 'Mindful Eating', `
# Beyond the Numbers

**Hunger Scale (1-10):**
- 1-2: Starving
- 3-4: Very hungry
- 5-6: Comfortable
- 7-8: Full
- 9-10: Stuffed

**Aim to:** Start eating at 3-4, stop at 6-7
  `, 10);

  await insertTask(pool, programId, taskOrder++, 5, 'action', 'Mindful Meal', 'Rate your hunger before and after your next meal.', 20, 'mindful_meal');
  await insertTask(pool, programId, taskOrder++, 5, 'reflection', 'Body Awareness', 'What did you notice about your hunger patterns?', 15);

  // Day 6 Tasks
  await insertTask(pool, programId, taskOrder++, 6, 'lesson', 'Planning Ahead', `
# The Power of Planning

**Why planning works:**
- Removes decision fatigue
- Ensures right foods available
- Prevents impulsive choices
- Saves time and money

**The 80/20 rule:** Plan 80% of meals, leave 20% for flexibility.
  `, 10);

  await insertTask(pool, programId, taskOrder++, 6, 'action', 'Plan Tomorrow', 'Use the meal planner to plan all meals for tomorrow.', 25, 'create_meal_plan');
  await insertTask(pool, programId, taskOrder++, 6, 'reflection', 'Planning Reflection', 'How does having a plan make you feel?', 15);

  // Day 7 Tasks
  await insertTask(pool, programId, taskOrder++, 7, 'lesson', 'Congratulations!', `
# You Did It!

**What you've accomplished:**
- Logged your first meals
- Learned about protein and calories
- Built a tracking habit
- Practiced mindful eating
- Planned ahead for success

People who track for 7+ days are **3x more likely** to reach their goals. You're now part of that group!
  `, 15);

  await insertTask(pool, programId, taskOrder++, 7, 'action', 'Review Your Week', 'Look at your nutrition summary for the past 7 days.', 20, 'view_summary');
  await insertTask(pool, programId, taskOrder++, 7, 'action', 'Set Your Next Goal', 'Set one specific goal for the next 30 days.', 20, 'set_goal');
  await insertTask(pool, programId, taskOrder++, 7, 'reflection', 'Final Reflection', 'What was your biggest insight this week?', 25);

  // Get task count
  const taskCount = await pool.query(
    `SELECT COUNT(*) FROM hc_tasks WHERE program_id = $1`,
    [programId]
  );

  console.log(`[Admin] Updated onboarding tasks: ${taskCount.rows[0].count} tasks`);

  return {
    program_id: programId,
    tasks_created: parseInt(taskCount.rows[0].count),
  };
}

async function insertTask(
  pool: Pool,
  programId: string,
  order: number,
  day: number,
  type: string,
  title: string,
  content: string,
  points: number,
  actionType?: string,
  quizData?: string
): Promise<void> {
  await pool.query(`
    INSERT INTO hc_tasks (
      program_id, task_order, day_number, task_type, title, content,
      points_value, action_type, quiz_questions, estimated_minutes
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
  `, [
    programId,
    order,
    day,
    type,
    title,
    content.trim(),
    points,
    actionType || null,
    quizData || null,
    type === 'lesson' ? 5 : type === 'action' ? 10 : type === 'reflection' ? 5 : 3
  ]);
}

export default createAdminRouter;
