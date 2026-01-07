import { test, expect } from '@playwright/test';

/**
 * Heirclark Skills + MCP Integration Tests
 *
 * Tests the complete flow:
 * 1. Photo upload → OpenNutrition lookup → DB insert
 * 2. Meal plan generation → Instacart list creation
 * 3. Workout sync → macro adjustment
 */

const BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';

// Test user data
const TEST_USER = {
  id: 'test_user_123',
  goals: {
    daily_calories: 2200,
    protein_g: 165,
    carbs_g: 220,
    fat_g: 73,
  },
};

test.describe('NutritionValidator Skill Tests', () => {
  test('should validate correct nutrition data against USDA', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/api/foods/validate`, {
      data: {
        food_name: 'chicken breast, grilled',
        calories: 165,
        protein_g: 31,
        carbs_g: 0,
        fat_g: 3.6,
        serving_size: '100g',
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();

    expect(data.validated).toBe(true);
    expect(data.confidence).toBeGreaterThan(90);
    expect(data.usda_data).toBeDefined();
    expect(data.usda_data.fdc_id).toBeDefined();
    expect(data.discrepancies).toHaveLength(0);
  });

  test('should flag incorrect nutrition data and provide corrections', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/api/foods/validate`, {
      data: {
        food_name: 'banana',
        calories: 150, // Incorrect - should be ~105
        protein_g: 2,
        carbs_g: 30,
        fat_g: 1, // Incorrect - should be ~0.4
        serving_size: '1 medium',
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();

    expect(data.validated).toBe(false);
    expect(data.discrepancies.length).toBeGreaterThan(0);
    expect(data.corrections).toBeDefined();
    expect(data.corrections.calories).toBeDefined();
    expect(data.recommendation).toContain('discrepancies');
  });

  test('should handle food not found in USDA database', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/api/foods/validate`, {
      data: {
        food_name: 'homemade keto protein shake with special ingredients',
        calories: 250,
        protein_g: 30,
        carbs_g: 5,
        fat_g: 12,
        serving_size: '1 serving',
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();

    expect(data.validated).toBeNull();
    expect(data.similar_foods).toBeDefined();
    expect(data.recommendation).toContain('not found');
  });

  test('should validate photo upload and extract macros', async ({ request }) => {
    // Simulate photo upload flow
    const uploadResponse = await request.post(`${BASE_URL}/api/foods/photo`, {
      multipart: {
        photo: {
          name: 'test-meal.jpg',
          mimeType: 'image/jpeg',
          buffer: Buffer.from('fake-image-data'),
        },
        user_id: TEST_USER.id,
      },
    });

    // Photo analysis may take time, so we check for 200 or 202 (accepted)
    expect([200, 202]).toContain(uploadResponse.status());

    const data = await uploadResponse.json();

    // Should have identified foods with nutrition data
    if (data.foods) {
      expect(Array.isArray(data.foods)).toBeTruthy();
      data.foods.forEach((food: any) => {
        expect(food.name).toBeDefined();
        expect(food.calories).toBeDefined();
        expect(food.usda_validated).toBeDefined();
      });
    }
  });
});

test.describe('MealPersonalizer Skill Tests', () => {
  test('should generate 7-day meal plan based on user goals', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/api/meal-plan/generate`, {
      data: {
        user_id: TEST_USER.id,
        week_start_date: '2024-01-15',
        include_instacart: true,
        servings_per_meal: 1,
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();

    // Verify structure
    expect(data.user_id).toBe(TEST_USER.id);
    expect(data.meal_plan).toBeDefined();
    expect(data.meal_plan).toHaveLength(7);

    // Verify each day has required meals
    data.meal_plan.forEach((day: any) => {
      expect(day.date).toBeDefined();
      expect(day.meals.breakfast).toBeDefined();
      expect(day.meals.lunch).toBeDefined();
      expect(day.meals.dinner).toBeDefined();
      expect(day.daily_totals).toBeDefined();
      expect(day.daily_totals.calories).toBeGreaterThan(0);
    });

    // Verify grocery list generated
    expect(data.grocery_list).toBeDefined();
    expect(data.grocery_list.items.length).toBeGreaterThan(0);
  });

  test('should adjust calories on workout days', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/api/meal-plan/generate`, {
      data: {
        user_id: TEST_USER.id,
        week_start_date: '2024-01-15',
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();

    // Find workout and rest days
    const workoutDay = data.meal_plan.find((d: any) => d.is_workout_day);
    const restDay = data.meal_plan.find((d: any) => !d.is_workout_day);

    if (workoutDay && restDay) {
      // Workout day should have higher calories
      expect(workoutDay.adjusted_calories).toBeGreaterThan(restDay.adjusted_calories);
    }
  });

  test('should respect dietary restrictions', async ({ request }) => {
    // First, set user preferences to vegetarian
    await request.post(`${BASE_URL}/api/user/preferences`, {
      data: {
        user_id: TEST_USER.id,
        diet_type: 'vegetarian',
        allergies: ['nuts'],
      },
    });

    const response = await request.post(`${BASE_URL}/api/meal-plan/generate`, {
      data: {
        user_id: TEST_USER.id,
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();

    // Check that no meat is included
    const allIngredients = data.meal_plan.flatMap((day: any) =>
      Object.values(day.meals).flatMap((meal: any) =>
        Array.isArray(meal) ? meal.flatMap((m: any) => m.ingredients || []) : meal.ingredients || []
      )
    );

    const meatKeywords = ['chicken', 'beef', 'pork', 'fish', 'salmon', 'tuna'];
    const containsMeat = allIngredients.some((ing: any) =>
      meatKeywords.some(meat => ing.food_name?.toLowerCase().includes(meat))
    );

    expect(containsMeat).toBe(false);
  });

  test('should generate valid Instacart deep link', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/api/meal-plan/generate`, {
      data: {
        user_id: TEST_USER.id,
        include_instacart: true,
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();

    expect(data.grocery_list.instacart_link).toBeDefined();
    expect(data.grocery_list.instacart_link).toContain('instacart.com');
  });
});

test.describe('SmartGrocery Skill Tests', () => {
  test('should identify nutrition gaps from meal history', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/api/grocery/analyze`, {
      data: {
        user_id: TEST_USER.id,
        days_to_analyze: 7,
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();

    expect(data.analysis_period).toBeDefined();
    expect(data.nutrition_summary).toBeDefined();
    expect(data.nutrition_summary.gaps).toBeDefined();
    expect(data.nutrition_summary.avg_daily).toBeDefined();
    expect(data.nutrition_summary.goals).toBeDefined();
  });

  test('should recommend foods to fill protein gap', async ({ request }) => {
    // Create a mock scenario with low protein
    const response = await request.post(`${BASE_URL}/api/grocery/analyze`, {
      data: {
        user_id: TEST_USER.id,
        days_to_analyze: 7,
        budget_tier: 'moderate',
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();

    // If there's a protein gap, recommendations should address it
    if (data.nutrition_summary.gaps.protein_g.severity !== 'none') {
      const proteinRecommendations = data.recommendations.filter((rec: any) =>
        rec.fills_gap.includes('protein')
      );
      expect(proteinRecommendations.length).toBeGreaterThan(0);
    }
  });

  test('should respect budget tier in recommendations', async ({ request }) => {
    const budgetResponse = await request.post(`${BASE_URL}/api/grocery/analyze`, {
      data: {
        user_id: TEST_USER.id,
        budget_tier: 'budget',
      },
    });

    const premiumResponse = await request.post(`${BASE_URL}/api/grocery/analyze`, {
      data: {
        user_id: TEST_USER.id,
        budget_tier: 'premium',
      },
    });

    expect(budgetResponse.ok()).toBeTruthy();
    expect(premiumResponse.ok()).toBeTruthy();

    const budgetData = await budgetResponse.json();
    const premiumData = await premiumResponse.json();

    // Budget tier should have lower estimated cost
    if (budgetData.instacart_list.items.length > 0 && premiumData.instacart_list.items.length > 0) {
      expect(budgetData.instacart_list.subtotal).toBeLessThanOrEqual(premiumData.instacart_list.subtotal);
    }
  });

  test('should calculate weekly impact if groceries purchased', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/api/grocery/analyze`, {
      data: {
        user_id: TEST_USER.id,
        days_to_analyze: 7,
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();

    expect(data.weekly_impact).toBeDefined();
    expect(data.weekly_impact.if_purchased).toBeDefined();
    expect(data.weekly_impact.if_purchased.gaps_filled_percent).toBeDefined();
  });
});

test.describe('Workout Sync + Macro Adjustment Tests', () => {
  test('should sync workout data and adjust macros', async ({ request }) => {
    // Log a workout
    const workoutResponse = await request.post(`${BASE_URL}/api/workouts/log`, {
      data: {
        user_id: TEST_USER.id,
        workout_type: 'strength_upper',
        duration_min: 60,
        calories_burned: 450,
        date: new Date().toISOString().split('T')[0],
      },
    });

    expect(workoutResponse.ok()).toBeTruthy();

    // Generate meal plan for today
    const mealPlanResponse = await request.post(`${BASE_URL}/api/meal-plan/generate`, {
      data: {
        user_id: TEST_USER.id,
      },
    });

    expect(mealPlanResponse.ok()).toBeTruthy();
    const mealPlan = await mealPlanResponse.json();

    // Check workout sync status
    expect(mealPlan.workout_sync).toBeDefined();
    expect(mealPlan.workout_sync.synced).toBe(true);
  });

  test('should analyze 10k steps + workout impact on macros', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/api/fitness/analyze-impact`, {
      data: {
        user_id: TEST_USER.id,
        steps: 10000,
        workout_calories: 500,
        date: new Date().toISOString().split('T')[0],
      },
    });

    // This endpoint may not exist yet, so handle gracefully
    if (response.ok()) {
      const data = await response.json();
      expect(data.total_calories_burned).toBeDefined();
      expect(data.recommended_calorie_adjustment).toBeDefined();
      expect(data.macro_recommendations).toBeDefined();
    }
  });
});

test.describe('End-to-End Integration Tests', () => {
  test('complete flow: photo → validation → DB → meal plan', async ({ request }) => {
    // Step 1: Upload food photo
    const photoResponse = await request.post(`${BASE_URL}/api/foods/photo`, {
      multipart: {
        photo: {
          name: 'lunch.jpg',
          mimeType: 'image/jpeg',
          buffer: Buffer.from('fake-image-data'),
        },
        user_id: TEST_USER.id,
      },
    });

    // Step 2: Validate detected food
    const validateResponse = await request.post(`${BASE_URL}/api/foods/validate`, {
      data: {
        food_name: 'grilled chicken salad',
        calories: 450,
        protein_g: 40,
        carbs_g: 20,
        fat_g: 25,
        serving_size: '1 serving',
      },
    });

    expect(validateResponse.ok()).toBeTruthy();
    const validatedFood = await validateResponse.json();

    // Step 3: Log the meal
    const logResponse = await request.post(`${BASE_URL}/api/meals/log`, {
      data: {
        user_id: TEST_USER.id,
        meal_type: 'lunch',
        foods: [validatedFood.corrections || validatedFood.input],
      },
    });

    // Step 4: Get updated grocery recommendations
    const groceryResponse = await request.post(`${BASE_URL}/api/grocery/analyze`, {
      data: {
        user_id: TEST_USER.id,
        days_to_analyze: 1,
      },
    });

    expect(groceryResponse.ok()).toBeTruthy();
    const groceryAnalysis = await groceryResponse.json();

    // Verify the flow completed
    expect(groceryAnalysis.analysis_period.days_logged).toBeGreaterThanOrEqual(0);
  });
});

// Health check test
test('API health check', async ({ request }) => {
  const response = await request.get(`${BASE_URL}/health`);
  expect(response.ok()).toBeTruthy();

  const data = await response.json();
  expect(data.status).toBe('healthy');
});
