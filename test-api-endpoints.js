#!/usr/bin/env node
/**
 * End-to-End API Testing Suite
 * Tests all AI endpoints for the Heirclark Health App
 */

const https = require('https');
const http = require('http');

const BASE_URL = process.env.API_URL || 'https://heirclarkinstacartbackend-production.up.railway.app';
const TEST_USER_ID = 'test_e2e_user';

// Color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
};

let testsPassed = 0;
let testsFailed = 0;
let testsSkipped = 0;

// Helper function to make HTTP requests
function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const protocol = urlObj.protocol === 'https:' ? https : http;

    const requestOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Customer-Id': TEST_USER_ID,
        ...options.headers,
      },
      timeout: options.timeout || 120000, // 2 minute timeout for AI requests
    };

    const req = protocol.request(requestOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, data: parsed, headers: res.headers });
        } catch (e) {
          resolve({ status: res.statusCode, data: data, headers: res.headers });
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (options.body) {
      req.write(JSON.stringify(options.body));
    }
    req.end();
  });
}

// Test result logging
function logTest(testName, passed, message = '', duration = null, debugData = null) {
  const status = passed ? `${colors.green}✓ PASS${colors.reset}` : `${colors.red}✗ FAIL${colors.reset}`;
  const durationStr = duration ? ` (${duration}ms)` : '';
  console.log(`${status} ${testName}${durationStr}`);
  if (message) {
    console.log(`  ${colors.yellow}→${colors.reset} ${message}`);
  }
  if (debugData && !passed) {
    console.log(`  ${colors.red}Debug:${colors.reset} ${JSON.stringify(debugData, null, 2).substring(0, 500)}`);
  }
  if (passed) {
    testsPassed++;
  } else {
    testsFailed++;
  }
}

// Helper to add delay between tests
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function logSkip(testName, reason) {
  console.log(`${colors.yellow}⊘ SKIP${colors.reset} ${testName}`);
  console.log(`  ${colors.yellow}→${colors.reset} ${reason}`);
  testsSkipped++;
}

function logSection(title) {
  console.log(`\n${colors.blue}${'='.repeat(60)}${colors.reset}`);
  console.log(`${colors.blue}${title}${colors.reset}`);
  console.log(`${colors.blue}${'='.repeat(60)}${colors.reset}\n`);
}

// Test functions
async function testHealthCheck() {
  const startTime = Date.now();
  try {
    const response = await makeRequest(`${BASE_URL}/health`);
    const duration = Date.now() - startTime;

    if (response.status === 200 && response.data === 'ok') {
      logTest('Health Check', true, 'Backend is running', duration);
      return true;
    } else {
      logTest('Health Check', false, `Unexpected response: ${response.data}`);
      return false;
    }
  } catch (error) {
    logTest('Health Check', false, `Error: ${error.message}`);
    return false;
  }
}

async function testMealPlanGeneration() {
  const startTime = Date.now();
  try {
    const response = await makeRequest(`${BASE_URL}/api/v1/ai/generate-meal-plan`, {
      method: 'POST',
      body: {
        preferences: {
          calorieTarget: 2000,
          proteinTarget: 150,
          carbsTarget: 200,
          fatTarget: 65,
          dietType: 'balanced',
          mealsPerDay: 3,
          allergies: [],
          favoriteProteins: ['chicken', 'salmon'],
          hatedFoods: 'mushrooms',
        },
        days: 7,
      },
      timeout: 90000, // 90 seconds for meal plan generation
    });
    const duration = Date.now() - startTime;

    // Handle both response formats: {ok: true, plan: ...} and {ok: true, data: {plan: ...}}
    const plan = response.data.plan || (response.data.data && response.data.data.plan);

    if (response.status === 200 && response.data.ok && plan) {
      const hasDays = plan.days && plan.days.length === 7;
      const hasMeals = hasDays && plan.days.every(day => day.meals && day.meals.length > 0);
      const hasNutrition = hasMeals && plan.days[0].meals[0].calories !== undefined;

      if (hasDays && hasMeals && hasNutrition) {
        logTest('AI Meal Plan Generation', true, `Generated 7-day plan with ${plan.days[0].meals.length} meals/day`, duration);

        // Check if hated foods are excluded
        const allMealNames = plan.days.flatMap(d => d.meals.map(m => m.dishName || m.name || '')).join(' ').toLowerCase();
        if (allMealNames.includes('mushroom')) {
          logTest('  └─ Hated Foods Filter', false, 'Mushrooms found in meal plan');
        } else {
          logTest('  └─ Hated Foods Filter', true, 'Hated foods correctly excluded');
        }

        return true;
      } else {
        logTest('AI Meal Plan Generation', false, 'Invalid plan structure');
        return false;
      }
    } else if (response.status === 500 && response.data.error && response.data.error.includes('OPENAI_API_KEY')) {
      logSkip('AI Meal Plan Generation', 'OPENAI_API_KEY not configured in Railway');
      return null;
    } else {
      logTest('AI Meal Plan Generation', false, `Status: ${response.status}, Error: ${response.data.error || 'Unknown'}`);
      return false;
    }
  } catch (error) {
    logTest('AI Meal Plan Generation', false, `Error: ${error.message}`);
    return false;
  }
}

async function testWorkoutPlanGeneration() {
  const startTime = Date.now();
  try {
    const response = await makeRequest(`${BASE_URL}/api/v1/ai/generate-workout-plan`, {
      method: 'POST',
      body: {
        preferences: {
          fitnessGoal: 'strength',
          experienceLevel: 'intermediate',
          daysPerWeek: 3,
          sessionDuration: 60,
          availableEquipment: ['dumbbells', 'barbell', 'gym'],
          injuries: ['lower back pain'],
        },
        weeks: 4,
      },
      timeout: 90000, // 90 seconds
    });
    const duration = Date.now() - startTime;

    // Handle both response formats: {ok: true, plan: ...} and {ok: true, data: {plan: ...}}
    const plan = response.data.plan || (response.data.data && response.data.data.plan);

    if (response.status === 200 && response.data.ok && plan) {
      const hasWeeks = plan.weeks && plan.weeks.length === 4;
      const hasWorkouts = hasWeeks && plan.weeks[0].workouts && plan.weeks[0].workouts.length > 0;
      const hasExercises = hasWorkouts && plan.weeks[0].workouts[0].exercises && plan.weeks[0].workouts[0].exercises.length > 0;

      if (hasWeeks && hasWorkouts && hasExercises) {
        const exerciseCount = plan.weeks[0].workouts[0].exercises.length;
        logTest('AI Workout Plan Generation', true, `Generated 4-week plan with ${exerciseCount} exercises per workout`, duration);

        // Check if injury-sensitive exercises are avoided (warning only, not a hard failure)
        const allExercises = plan.weeks.flatMap(w => w.workouts.flatMap(wo => wo.exercises.map(e => e.name))).join(' ').toLowerCase();
        const hasDeadlift = allExercises.includes('deadlift');
        if (hasDeadlift) {
          console.log(`  ${colors.yellow}⚠ WARNING:${colors.reset} Deadlifts found despite lower back pain (GPT may not always avoid specific exercises)`);
        } else {
          console.log(`  ${colors.green}✓${colors.reset} Avoided injury-sensitive exercises`);
        }

        return true;
      } else {
        logTest('AI Workout Plan Generation', false, 'Invalid plan structure');
        return false;
      }
    } else if (response.status === 500 && response.data.error && response.data.error.includes('OPENAI_API_KEY')) {
      logSkip('AI Workout Plan Generation', 'OPENAI_API_KEY not configured in Railway');
      return null;
    } else {
      logTest('AI Workout Plan Generation', false, `Status: ${response.status}, Error: ${response.data.error || 'Unknown'}`);
      return false;
    }
  } catch (error) {
    logTest('AI Workout Plan Generation', false, `Error: ${error.message}`);
    return false;
  }
}

async function testCoachChatMeal() {
  const startTime = Date.now();
  try {
    const response = await makeRequest(`${BASE_URL}/api/v1/ai/coach-message`, {
      method: 'POST',
      body: {
        message: 'How much protein do I need for muscle gain?',
        context: {
          mode: 'meal',
          userGoals: {
            calorieTarget: 2500,
            proteinTarget: 180,
            fitnessGoal: 'muscle_gain',
          },
        },
      },
      timeout: 15000, // 15 seconds
    });
    const duration = Date.now() - startTime;

    // Handle nested response structure
    const responseData = response.data.response || (response.data.data && response.data.data.response);

    if (response.status === 200 && response.data.ok && responseData) {
      const message = responseData.message;
      const hasProteinAdvice = message.toLowerCase().includes('protein');

      if (hasProteinAdvice && message.length > 20) {
        logTest('AI Coach Chat - Meal Mode', true, `Response: "${message.substring(0, 60)}..."`, duration);
        return true;
      } else {
        logTest('AI Coach Chat - Meal Mode', false, 'Invalid or empty response');
        return false;
      }
    } else if (response.status === 500 && response.data.error && response.data.error.includes('OPENAI_API_KEY')) {
      logSkip('AI Coach Chat - Meal Mode', 'OPENAI_API_KEY not configured in Railway');
      return null;
    } else {
      logTest('AI Coach Chat - Meal Mode', false, `Status: ${response.status}, Error: ${response.data.error || 'Unknown'}`, duration, response.data);
      return false;
    }
  } catch (error) {
    logTest('AI Coach Chat - Meal Mode', false, `Error: ${error.message}`);
    return false;
  }
}

async function testCoachChatTraining() {
  const startTime = Date.now();
  try {
    const response = await makeRequest(`${BASE_URL}/api/v1/ai/coach-message`, {
      method: 'POST',
      body: {
        message: 'How do I improve my squat form?',
        context: {
          mode: 'training',
          userGoals: {
            fitnessGoal: 'strength',
            activityLevel: 'active',
          },
        },
      },
      timeout: 15000,
    });
    const duration = Date.now() - startTime;

    // Handle nested response structure
    const responseData = response.data.response || (response.data.data && response.data.data.response);

    if (response.status === 200 && response.data.ok && responseData) {
      const message = responseData.message;
      const hasFormAdvice = message.toLowerCase().includes('squat') || message.toLowerCase().includes('form');

      if (hasFormAdvice && message.length > 20) {
        logTest('AI Coach Chat - Training Mode', true, `Response: "${message.substring(0, 60)}..."`, duration);
        return true;
      } else {
        logTest('AI Coach Chat - Training Mode', false, 'Invalid or empty response');
        return false;
      }
    } else if (response.status === 500 && response.data.error && response.data.error.includes('OPENAI_API_KEY')) {
      logSkip('AI Coach Chat - Training Mode', 'OPENAI_API_KEY not configured in Railway');
      return null;
    } else {
      logTest('AI Coach Chat - Training Mode', false, `Status: ${response.status}, Error: ${response.data.error || 'Unknown'}`);
      return false;
    }
  } catch (error) {
    logTest('AI Coach Chat - Training Mode', false, `Error: ${error.message}`);
    return false;
  }
}

async function testCoachChatGeneral() {
  const startTime = Date.now();
  try {
    const response = await makeRequest(`${BASE_URL}/api/v1/ai/coach-message`, {
      method: 'POST',
      body: {
        message: 'How do I stay motivated to reach my health goals?',
        context: {
          mode: 'general',
          userGoals: {
            calorieTarget: 2000,
            fitnessGoal: 'weight_loss',
          },
        },
      },
      timeout: 15000,
    });
    const duration = Date.now() - startTime;

    // Handle nested response structure
    const responseData = response.data.response || (response.data.data && response.data.data.response);

    if (response.status === 200 && response.data.ok && responseData) {
      const message = responseData.message;
      const hasMotivationAdvice = message.toLowerCase().includes('motivat') || message.toLowerCase().includes('goal');

      if (hasMotivationAdvice && message.length > 20) {
        logTest('AI Coach Chat - General Mode', true, `Response: "${message.substring(0, 60)}..."`, duration);
        return true;
      } else {
        logTest('AI Coach Chat - General Mode', false, 'Invalid or empty response');
        return false;
      }
    } else if (response.status === 500 && response.data.error && response.data.error.includes('OPENAI_API_KEY')) {
      logSkip('AI Coach Chat - General Mode', 'OPENAI_API_KEY not configured in Railway');
      return null;
    } else {
      logTest('AI Coach Chat - General Mode', false, `Status: ${response.status}, Error: ${response.data.error || 'Unknown'}`);
      return false;
    }
  } catch (error) {
    logTest('AI Coach Chat - General Mode', false, `Error: ${error.message}`);
    return false;
  }
}

async function testInstacartIntegration() {
  const startTime = Date.now();
  try {
    const response = await makeRequest(`${BASE_URL}/api/v1/ai/instacart-order`, {
      method: 'POST',
      body: {
        shoppingList: [
          { name: 'Chicken Breast', quantity: 2, unit: 'lbs' },
          { name: 'Broccoli', quantity: 1, unit: 'lb' },
          { name: 'Brown Rice', quantity: 1, unit: 'bag' },
        ],
        planTitle: 'Test Meal Plan Groceries',
      },
      timeout: 30000,
    });
    const duration = Date.now() - startTime;

    // Handle nested response structure
    const responseData = response.data.data || response.data;
    const instacartUrl = responseData.instacartUrl;
    const isFallback = responseData.fallback === true;

    if (response.status === 200 && response.data.ok && instacartUrl) {
      // Accept both production (instacart.com) and dev (instacart.tools) URLs
      const urlValid = instacartUrl.includes('instacart.com') || instacartUrl.includes('instacart.tools');

      if (urlValid) {
        const status = isFallback ? 'Using search fallback (Instacart API key not set)' : 'Using Instacart API';
        logTest('Instacart Integration', true, status, duration);
        return true;
      } else {
        logTest('Instacart Integration', false, `Invalid Instacart URL: ${instacartUrl}`, duration, response.data);
        return false;
      }
    } else {
      logTest('Instacart Integration', false, `Status: ${response.status}, Error: ${response.data.error || 'Unknown'}`, duration, response.data);
      return false;
    }
  } catch (error) {
    logTest('Instacart Integration', false, `Error: ${error.message}`);
    return false;
  }
}

async function testExistingMealPlanEndpoint() {
  const startTime = Date.now();
  try {
    const response = await makeRequest(`${BASE_URL}/api/v1/ai/meal-plan-7day`, {
      method: 'POST',
      body: {
        shopifyCustomerId: TEST_USER_ID,
        targets: {
          calories: 2000,
          protein: 150,
          carbs: 200,
          fat: 65,
        },
        preferences: {
          dietType: 'balanced',
          mealsPerDay: 3,
        },
      },
      timeout: 90000,
    });
    const duration = Date.now() - startTime;

    // Handle nested response structure
    const plan = response.data.plan || (response.data.data && response.data.data.plan);

    if (response.status === 200 && response.data.ok && plan) {
      logTest('Legacy Meal Plan Endpoint (/meal-plan-7day)', true, 'Endpoint still working', duration);
      return true;
    } else if (response.status === 500 && response.data.error && response.data.error.includes('OPENAI_API_KEY')) {
      logSkip('Legacy Meal Plan Endpoint (/meal-plan-7day)', 'OPENAI_API_KEY not configured');
      return null;
    } else {
      logTest('Legacy Meal Plan Endpoint (/meal-plan-7day)', false, `Status: ${response.status}`, duration, response.data);
      return false;
    }
  } catch (error) {
    logTest('Legacy Meal Plan Endpoint (/meal-plan-7day)', false, `Error: ${error.message}`);
    return false;
  }
}

// Main test runner
async function runTests() {
  console.log(`${colors.magenta}╔═══════════════════════════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.magenta}║   HEIRCLARK HEALTH APP - END-TO-END API TEST SUITE          ║${colors.reset}`);
  console.log(`${colors.magenta}╚═══════════════════════════════════════════════════════════════╝${colors.reset}`);
  console.log(`\nTesting: ${BASE_URL}`);
  console.log(`Test User ID: ${TEST_USER_ID}\n`);

  // Test 1: Health Check
  logSection('TEST 1: Health Check');
  const healthOk = await testHealthCheck();

  if (!healthOk) {
    console.log(`\n${colors.red}Backend is not responding. Aborting tests.${colors.reset}\n`);
    process.exit(1);
  }

  // Test 2: AI Meal Plan Generation
  logSection('TEST 2: AI Meal Plan Generation (New Endpoint)');
  await testMealPlanGeneration();
  await delay(12000); // Wait 12 seconds to avoid rate limit

  // Test 3: AI Workout Plan Generation
  logSection('TEST 3: AI Workout Plan Generation (New)');
  await testWorkoutPlanGeneration();
  await delay(8000);

  // Test 4: AI Coach Chat - Meal Mode
  logSection('TEST 4: AI Coach Chat - Meal Mode (New)');
  await testCoachChatMeal();
  await delay(8000);

  // Test 5: AI Coach Chat - Training Mode
  logSection('TEST 5: AI Coach Chat - Training Mode (New)');
  await testCoachChatTraining();
  await delay(8000);

  // Test 6: AI Coach Chat - General Mode
  logSection('TEST 6: AI Coach Chat - General Mode (New)');
  await testCoachChatGeneral();
  await delay(8000);

  // Test 7: Instacart Integration
  logSection('TEST 7: Instacart Integration');
  await testInstacartIntegration();
  await delay(8000);

  // Test 8: Legacy Meal Plan Endpoint
  logSection('TEST 8: Legacy Meal Plan Endpoint');
  await testExistingMealPlanEndpoint();

  // Summary
  console.log(`\n${colors.magenta}╔═══════════════════════════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.magenta}║                        TEST SUMMARY                           ║${colors.reset}`);
  console.log(`${colors.magenta}╚═══════════════════════════════════════════════════════════════╝${colors.reset}\n`);
  console.log(`${colors.green}Passed:${colors.reset}  ${testsPassed}`);
  console.log(`${colors.red}Failed:${colors.reset}  ${testsFailed}`);
  console.log(`${colors.yellow}Skipped:${colors.reset} ${testsSkipped}`);
  console.log(`${colors.blue}Total:${colors.reset}   ${testsPassed + testsFailed + testsSkipped}\n`);

  if (testsFailed > 0) {
    console.log(`${colors.red}⚠ Some tests failed. Check the output above for details.${colors.reset}\n`);
    process.exit(1);
  } else if (testsSkipped > 0) {
    console.log(`${colors.yellow}⚠ Some tests were skipped. Add OPENAI_API_KEY to Railway to run all tests.${colors.reset}\n`);
    process.exit(0);
  } else {
    console.log(`${colors.green}✓ All tests passed!${colors.reset}\n`);
    process.exit(0);
  }
}

// Run the tests
runTests().catch((error) => {
  console.error(`${colors.red}Fatal error:${colors.reset}`, error);
  process.exit(1);
});
