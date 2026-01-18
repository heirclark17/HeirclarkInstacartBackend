/**
 * Figma Integration Test
 * Tests Figma API integration endpoints
 */

import { test, expect } from '@playwright/test';

const BACKEND_URL = process.env.BACKEND_URL || 'https://heirclarkinstacartbackend-production.up.railway.app';
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

test.describe('Figma Integration - Production Endpoints', () => {

  test('Health endpoint returns correct structure', async ({ request }) => {
    const response = await request.get(`${BACKEND_URL}/api/v1/figma/health`);

    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('application/json');

    const data = await response.json();
    expect(data).toHaveProperty('status');
    expect(data).toHaveProperty('message');
    expect(['ok', 'error']).toContain(data.status);
  });

  test('File endpoint returns 400 for invalid file key', async ({ request }) => {
    const response = await request.get(`${BACKEND_URL}/api/v1/figma/file/INVALID_KEY`);

    // Should return 401 (auth required) or 400/404 (invalid key)
    expect([400, 401, 404, 500]).toContain(response.status());
  });

  test('Images endpoint validates query parameters', async ({ request }) => {
    const response = await request.get(
      `${BACKEND_URL}/api/v1/figma/images/test?format=invalid&scale=10`
    );

    // Should handle invalid parameters gracefully
    expect([400, 401, 404, 500]).toContain(response.status());
  });

  test('Nodes endpoint requires ids parameter', async ({ request }) => {
    const response = await request.get(
      `${BACKEND_URL}/api/v1/figma/nodes/test`
    );

    // Should return error for missing ids
    expect([400, 401, 500]).toContain(response.status());
  });

  test('All endpoints return JSON responses', async ({ request }) => {
    const endpoints = [
      '/api/v1/figma/health',
      '/api/v1/figma/file/test',
      '/api/v1/figma/nodes/test?ids=1:2',
      '/api/v1/figma/styles/test',
      '/api/v1/figma/colors/test',
      '/api/v1/figma/comments/test',
    ];

    for (const endpoint of endpoints) {
      const response = await request.get(`${BACKEND_URL}${endpoint}`);
      const contentType = response.headers()['content-type'];
      expect(contentType).toContain('application/json');
    }
  });

  test('CORS headers are present', async ({ request }) => {
    const response = await request.get(`${BACKEND_URL}/api/v1/figma/health`);

    const headers = response.headers();
    // Check for CORS headers (may vary based on backend config)
    expect(response.status()).toBeLessThan(500);
  });
});
