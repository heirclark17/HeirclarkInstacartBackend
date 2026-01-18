/**
 * Figma Integration Test
 * Tests Figma API integration endpoints
 */

import { test, expect } from '@playwright/test';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';
const TEST_FIGMA_FILE_KEY = process.env.TEST_FIGMA_FILE_KEY || '';

test.describe('Figma Integration', () => {

  test('Backend health check should return ok', async ({ request }) => {
    const response = await request.get(`${BACKEND_URL}/health`);

    expect(response.status()).toBe(200);
    const text = await response.text();
    expect(text).toBe('ok');
  });

  test('Figma health check endpoint should verify API key', async ({ request }) => {
    const response = await request.get(`${BACKEND_URL}/api/v1/figma/health`);

    expect(response.status()).toBe(200);
    const data = await response.json();

    // Should return status object
    expect(data).toHaveProperty('status');
    expect(data).toHaveProperty('message');

    // Log the result
    console.log('Figma API Status:', data.status);
    console.log('Figma API Message:', data.message);

    // If FIGMA_API_KEY is configured, it should be 'ok'
    if (data.status === 'ok') {
      console.log('✅ Figma API key is valid');
      expect(data.message).toContain('Connected');
    } else {
      console.log('⚠️ Figma API key is not configured or invalid');
      console.log('   Add FIGMA_API_KEY to Railway environment variables');
    }
  });

  test('Figma file endpoint should require authentication', async ({ request }) => {
    // Skip if no test file key provided
    if (!TEST_FIGMA_FILE_KEY) {
      test.skip();
      return;
    }

    const response = await request.get(
      `${BACKEND_URL}/api/v1/figma/file/${TEST_FIGMA_FILE_KEY}`
    );

    // Without auth, should return 401
    expect(response.status()).toBe(401);
  });

  test('Figma nodes endpoint should require authentication', async ({ request }) => {
    // Skip if no test file key provided
    if (!TEST_FIGMA_FILE_KEY) {
      test.skip();
      return;
    }

    const response = await request.get(
      `${BACKEND_URL}/api/v1/figma/nodes/${TEST_FIGMA_FILE_KEY}?ids=1:2,1:3`
    );

    // Without auth, should return 401
    expect(response.status()).toBe(401);
  });

  test('Figma images endpoint should require authentication', async ({ request }) => {
    // Skip if no test file key provided
    if (!TEST_FIGMA_FILE_KEY) {
      test.skip();
      return;
    }

    const response = await request.get(
      `${BACKEND_URL}/api/v1/figma/images/${TEST_FIGMA_FILE_KEY}?ids=1:2&format=png&scale=2`
    );

    // Without auth, should return 401
    expect(response.status()).toBe(401);
  });

  test('Figma styles endpoint should require authentication', async ({ request }) => {
    // Skip if no test file key provided
    if (!TEST_FIGMA_FILE_KEY) {
      test.skip();
      return;
    }

    const response = await request.get(
      `${BACKEND_URL}/api/v1/figma/styles/${TEST_FIGMA_FILE_KEY}`
    );

    // Without auth, should return 401
    expect(response.status()).toBe(401);
  });

  test('Figma colors endpoint should require authentication', async ({ request }) => {
    // Skip if no test file key provided
    if (!TEST_FIGMA_FILE_KEY) {
      test.skip();
      return;
    }

    const response = await request.get(
      `${BACKEND_URL}/api/v1/figma/colors/${TEST_FIGMA_FILE_KEY}`
    );

    // Without auth, should return 401
    expect(response.status()).toBe(401);
  });

  test('Figma comments endpoint should require authentication', async ({ request }) => {
    // Skip if no test file key provided
    if (!TEST_FIGMA_FILE_KEY) {
      test.skip();
      return;
    }

    const response = await request.get(
      `${BACKEND_URL}/api/v1/figma/comments/${TEST_FIGMA_FILE_KEY}`
    );

    // Without auth, should return 401
    expect(response.status()).toBe(401);
  });
});

test.describe('Figma Integration - Environment Variables', () => {

  test('FIGMA_API_KEY should be configured in environment', async () => {
    // This test checks if the env var is loaded in the backend
    // We can verify this by checking the health endpoint

    const response = await fetch(`${BACKEND_URL}/api/v1/figma/health`);
    const data = await response.json();

    if (data.status === 'ok') {
      console.log('✅ FIGMA_API_KEY is configured and valid');
      console.log(`   Connected as: ${data.message}`);
      expect(data.status).toBe('ok');
    } else {
      console.log('❌ FIGMA_API_KEY is NOT configured or invalid');
      console.log('   To fix:');
      console.log('   1. Go to Railway Dashboard');
      console.log('   2. Navigate to your service → Variables');
      console.log('   3. Add: FIGMA_API_KEY=figd_YOUR_TOKEN');
      console.log('   4. Redeploy the service');

      // Fail the test if API key is not configured
      expect(data.status).toBe('ok');
    }
  });
});
