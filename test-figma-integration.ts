/**
 * Figma Integration Test
 * Verifies Figma API integration is working correctly
 */

import { chromium } from 'playwright';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';
const TEST_FILE_KEY = process.env.TEST_FIGMA_FILE_KEY || ''; // Add a test Figma file key

interface TestResult {
  endpoint: string;
  status: 'PASS' | 'FAIL';
  statusCode?: number;
  message: string;
  data?: any;
}

const results: TestResult[] = [];

async function testEndpoint(
  page: any,
  method: string,
  endpoint: string,
  expectedStatus: number,
  description: string
) {
  try {
    console.log(`\n🧪 Testing: ${description}`);
    console.log(`   Endpoint: ${method} ${endpoint}`);

    const response = await page.goto(endpoint, {
      waitUntil: 'networkidle',
      timeout: 30000,
    });

    const status = response.status();
    const contentType = response.headers()['content-type'] || '';

    let body = null;
    try {
      body = await response.json();
    } catch (e) {
      body = await response.text();
    }

    console.log(`   Status: ${status}`);
    console.log(`   Content-Type: ${contentType}`);

    if (status === expectedStatus) {
      console.log(`   ✅ PASS`);
      results.push({
        endpoint,
        status: 'PASS',
        statusCode: status,
        message: description,
        data: body,
      });
    } else {
      console.log(`   ❌ FAIL - Expected ${expectedStatus}, got ${status}`);
      results.push({
        endpoint,
        status: 'FAIL',
        statusCode: status,
        message: `${description} - Expected ${expectedStatus}, got ${status}`,
        data: body,
      });
    }

    // Show response preview
    if (typeof body === 'object') {
      console.log(`   Response:`, JSON.stringify(body, null, 2).substring(0, 200));
    } else {
      console.log(`   Response:`, String(body).substring(0, 200));
    }

    return { status, body };
  } catch (error: any) {
    console.log(`   ❌ ERROR: ${error.message}`);
    results.push({
      endpoint,
      status: 'FAIL',
      message: `${description} - ${error.message}`,
    });
    return { status: 0, body: null };
  }
}

async function runTests() {
  console.log('🚀 Starting Figma Integration Tests');
  console.log(`📍 Backend URL: ${BACKEND_URL}`);
  console.log('=' . repeat(80));

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Test 1: Backend health check
  await testEndpoint(
    page,
    'GET',
    `${BACKEND_URL}/health`,
    200,
    'Backend health check'
  );

  // Test 2: Figma health check (no auth required)
  const healthResult = await testEndpoint(
    page,
    'GET',
    `${BACKEND_URL}/api/v1/figma/health`,
    200,
    'Figma API health check (tests FIGMA_API_KEY validity)'
  );

  // If health check passed, test authenticated endpoints
  if (healthResult.status === 200 && healthResult.body?.status === 'ok') {
    console.log('\n✅ Figma API key is valid!');
    console.log(`   Connected as: ${healthResult.body.message}`);

    // Test authenticated endpoints (these will require auth header)
    // For now, we'll test that they return proper error codes without auth

    // Test 3: Get Figma file (should fail without auth)
    if (TEST_FILE_KEY) {
      await testEndpoint(
        page,
        'GET',
        `${BACKEND_URL}/api/v1/figma/file/${TEST_FILE_KEY}`,
        401,
        'Figma file endpoint (expects 401 without auth)'
      );
    } else {
      console.log('\n⚠️  Skipping file test - no TEST_FIGMA_FILE_KEY provided');
    }

    // Test 4: Get Figma nodes (should fail without auth)
    if (TEST_FILE_KEY) {
      await testEndpoint(
        page,
        'GET',
        `${BACKEND_URL}/api/v1/figma/nodes/${TEST_FILE_KEY}?ids=1:2,1:3`,
        401,
        'Figma nodes endpoint (expects 401 without auth)'
      );
    }

    // Test 5: Get Figma images (should fail without auth)
    if (TEST_FILE_KEY) {
      await testEndpoint(
        page,
        'GET',
        `${BACKEND_URL}/api/v1/figma/images/${TEST_FILE_KEY}?ids=1:2&format=png&scale=2`,
        401,
        'Figma images endpoint (expects 401 without auth)'
      );
    }

    // Test 6: Get Figma styles (should fail without auth)
    if (TEST_FILE_KEY) {
      await testEndpoint(
        page,
        'GET',
        `${BACKEND_URL}/api/v1/figma/styles/${TEST_FILE_KEY}`,
        401,
        'Figma styles endpoint (expects 401 without auth)'
      );
    }

  } else {
    console.log('\n❌ Figma API key is NOT valid or not configured');
    console.log('   Response:', healthResult.body);
  }

  await browser.close();

  // Print summary
  console.log('\n' + '='.repeat(80));
  console.log('📊 TEST SUMMARY');
  console.log('='.repeat(80));

  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;

  console.log(`\n✅ PASSED: ${passed}`);
  console.log(`❌ FAILED: ${failed}`);
  console.log(`📝 TOTAL:  ${results.length}\n`);

  if (failed === 0) {
    console.log('🎉 All tests passed!');
    process.exit(0);
  } else {
    console.log('⚠️  Some tests failed. Review the output above.');
    process.exit(1);
  }
}

// Run tests
runTests().catch((error) => {
  console.error('❌ Test suite error:', error);
  process.exit(1);
});
