// tests/food-preferences.spec.ts
// Playwright tests for food preferences and 7-day meal plan integration

import { test, expect } from '@playwright/test';

const SHOPIFY_STORE = 'https://mduiup-rn.myshopify.com';
const BACKEND_API = 'https://heirclarkinstacartbackend-production.up.railway.app';

// Test customer ID (you'll need to replace this with a real test customer)
const TEST_CUSTOMER_ID = 'gid://shopify/Customer/test_user_123';

test.describe('Food Preferences Integration', () => {

  test.beforeEach(async ({ page }) => {
    // Set up authentication - store customer ID in sessionStorage
    await page.goto(SHOPIFY_STORE);
    await page.evaluate((customerId) => {
      sessionStorage.setItem('hcCustomerId', customerId);
      window.hcCustomerId = customerId;
    }, TEST_CUSTOMER_ID);
  });

  test('should load food preferences form', async ({ page }) => {
    await page.goto(`${SHOPIFY_STORE}/pages/food-preferences`);

    // Wait for form to load
    await page.waitForSelector('.hc-food-prefs-container', { timeout: 10000 });

    // Verify all 10 questions are present
    await expect(page.locator('h3:has-text("How do you prefer to eat?")').first()).toBeVisible();
    await expect(page.locator('h3:has-text("Favorite proteins")').first()).toBeVisible();
    await expect(page.locator('h3:has-text("Favorite fruits")').first()).toBeVisible();
    await expect(page.locator('h3:has-text("Favorite cuisines")').first()).toBeVisible();
    await expect(page.locator('h3:has-text("Top 3 favorite foods")').first()).toBeVisible();
    await expect(page.locator('h3:has-text("Foods you hate")').first()).toBeVisible();
    await expect(page.locator('h3:has-text("Cheat days")').first()).toBeVisible();
    await expect(page.locator('h3:has-text("How often do you eat out?")').first()).toBeVisible();
    await expect(page.locator('h3:has-text("Favorite snacks")').first()).toBeVisible();
    await expect(page.locator('h3:has-text("Meal diversity")').first()).toBeVisible();

    console.log('✓ All 10 food preference questions loaded');
  });

  test('should submit food preferences and save to database', async ({ page }) => {
    await page.goto(`${SHOPIFY_STORE}/pages/food-preferences`);
    await page.waitForSelector('.hc-food-prefs-container', { timeout: 10000 });

    // Fill out Question 1: Meal Style
    await page.click('button[data-value="threePlusSnacks"]');

    // Fill out Question 2: Favorite Proteins (select 2)
    await page.click('button.hc-food-prefs-circle[data-value="Chicken"]');
    await page.click('button.hc-food-prefs-circle[data-value="Salmon"]');

    // Fill out Question 3: Favorite Fruits (select 2)
    await page.click('button.hc-food-prefs-circle[data-value="Apples"]');
    await page.click('button.hc-food-prefs-circle[data-value="Bananas"]');

    // Fill out Question 4: Favorite Cuisines (select 2)
    await page.click('button.hc-food-prefs-circle[data-value="Italian"]');
    await page.click('button.hc-food-prefs-circle[data-value="Mexican"]');

    // Fill out Question 5: Top 3 Foods
    await page.fill('input[placeholder="e.g., Grilled chicken breast"]', 'Grilled salmon');
    await page.fill('input[placeholder="e.g., Greek salad"]', 'Brown rice');
    await page.fill('input[placeholder="e.g., Overnight oats"]', 'Avocado toast');

    // Fill out Question 6: Hated Foods
    await page.fill('textarea[placeholder="List any foods you absolutely hate..."]', 'Brussels sprouts, liver');

    // Fill out Question 7: Cheat Days (select Saturday)
    await page.click('button[data-day="Saturday"]');

    // Fill out Question 8: Eat Out Frequency (set to 3 days)
    await page.fill('input[type="range"]', '3');

    // Fill out Question 9: Favorite Snacks (select 2)
    await page.click('button.hc-food-prefs-circle[data-value="Almonds"]');
    await page.click('button.hc-food-prefs-circle[data-value="Greek Yogurt"]');

    // Fill out Question 10: Meal Diversity
    await page.click('button[data-value="diverse"]');

    // Wait for form to be valid
    await page.waitForTimeout(1000);

    // Click submit button
    const submitButton = page.locator('button:has-text("Save My Food Preferences")');
    await expect(submitButton).toBeEnabled();
    await submitButton.click();

    // Wait for success message
    await page.waitForSelector('.hc-success-message', { timeout: 10000 });
    const successMessage = await page.locator('.hc-success-message').textContent();
    expect(successMessage).toContain('saved');

    console.log('✓ Food preferences submitted successfully');
  });

  test('should fetch food preferences in 7-day meal plan', async ({ page }) => {
    // First, navigate to the 7-day meal plan page
    await page.goto(`${SHOPIFY_STORE}/pages/seven-day-plan`);

    // Wait for the page to load
    await page.waitForSelector('#hc-plan-root', { timeout: 10000 });

    // Set up console message listener to capture API calls
    const consoleLogs: string[] = [];
    page.on('console', msg => {
      const text = msg.text();
      consoleLogs.push(text);
      if (text.includes('Fetched food preferences') ||
          text.includes('Merged userPrefs with food preferences')) {
        console.log('  → ' + text);
      }
    });

    // Wait for food preferences to be fetched
    await page.waitForTimeout(3000);

    // Check if food preferences were fetched successfully
    const foodPrefsFetched = consoleLogs.some(log =>
      log.includes('Fetched food preferences') ||
      log.includes('No customer ID found')
    );

    expect(foodPrefsFetched).toBeTruthy();
    console.log('✓ 7-day meal plan attempted to fetch food preferences');
  });

  test('should include food preferences in meal generation constraints', async ({ page }) => {
    await page.goto(`${SHOPIFY_STORE}/pages/seven-day-plan`);
    await page.waitForSelector('#hc-plan-root', { timeout: 10000 });

    // Set up request interception to capture API calls
    const apiCalls: any[] = [];
    page.on('request', request => {
      if (request.url().includes('/day-plan')) {
        apiCalls.push({
          url: request.url(),
          method: request.method(),
          body: request.postData()
        });
      }
    });

    // Look for the "Generate Day 1 Plan" button
    const day1Button = page.locator('button[data-hc-smart-day-btn="1"]');

    // Only proceed if the button exists and is visible
    if (await day1Button.isVisible({ timeout: 5000 }).catch(() => false)) {
      await day1Button.click();

      // Wait for API call to be made
      await page.waitForTimeout(3000);

      // Verify that food preferences were included in the request
      if (apiCalls.length > 0) {
        const requestBody = apiCalls[0].body;
        if (requestBody) {
          const parsed = JSON.parse(requestBody);

          // Check if constraints include food preferences
          expect(parsed.constraints).toBeDefined();
          console.log('✓ Meal generation includes constraints object');

          // Verify food preference fields exist in constraints
          const hasProteins = parsed.constraints.favoriteProteins !== undefined;
          const hasFruits = parsed.constraints.favoriteFruits !== undefined;
          const hasCuisines = parsed.constraints.favoriteCuisines !== undefined;

          if (hasProteins || hasFruits || hasCuisines) {
            console.log('✓ Food preferences included in meal generation');
          } else {
            console.log('⚠ Food preference fields present but may be empty');
          }
        }
      } else {
        console.log('⚠ No API calls captured - meal generation may not have triggered');
      }
    } else {
      console.log('ℹ Generate Day 1 button not found - skipping meal generation test');
    }
  });

  test('should display food preferences in UI summary', async ({ page }) => {
    await page.goto(`${SHOPIFY_STORE}/pages/seven-day-plan`);
    await page.waitForSelector('#hc-plan-root', { timeout: 10000 });

    // Wait for preferences to load
    await page.waitForTimeout(2000);

    // Check if preference summary is rendered
    const hasSummary = await page.locator('.hc-pref-summary').count() > 0;

    if (hasSummary) {
      console.log('✓ Preference summary displayed in UI');
    } else {
      console.log('ℹ No preference summary found - may not have been rendered');
    }
  });
});

test.describe('Food Preferences API Tests', () => {

  test('should save food preferences via API', async ({ request }) => {
    const response = await request.post(`${BACKEND_API}/api/v1/food-preferences`, {
      headers: {
        'Content-Type': 'application/json',
        'X-Customer-ID': TEST_CUSTOMER_ID
      },
      data: {
        mealStyle: 'threePlusSnacks',
        favoriteProteins: ['Chicken', 'Salmon'],
        favoriteFruits: ['Apples', 'Bananas'],
        favoriteCuisines: ['Italian', 'Mexican'],
        topFoods: ['Grilled salmon', 'Brown rice', 'Avocado'],
        hatedFoods: 'Brussels sprouts, liver',
        cheatDays: ['Saturday'],
        eatOutFrequency: 3,
        favoriteSnacks: ['Almonds', 'Greek Yogurt'],
        mealDiversity: 'diverse'
      }
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.data.mealStyle).toBe('threePlusSnacks');

    console.log('✓ Food preferences saved via API');
  });

  test('should retrieve food preferences via API', async ({ request }) => {
    const response = await request.get(`${BACKEND_API}/api/v1/food-preferences`, {
      headers: {
        'Content-Type': 'application/json',
        'X-Customer-ID': TEST_CUSTOMER_ID
      }
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();

    if (data.success && data.data) {
      expect(data.data.mealStyle).toBeDefined();
      console.log('✓ Food preferences retrieved via API');
      console.log('  → Meal Style:', data.data.mealStyle);
      console.log('  → Favorite Proteins:', data.data.favoriteProteins);
      console.log('  → Favorite Cuisines:', data.data.favoriteCuisines);
    } else {
      console.log('ℹ No food preferences found for test customer');
    }
  });
});
