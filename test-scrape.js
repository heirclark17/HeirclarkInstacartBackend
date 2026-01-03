/**
 * Firecrawl Scraping Integration Tests
 *
 * Tests the web scraping endpoints and Firecrawl integration.
 *
 * Run: node test-scrape.js
 * Or with env: FIRECRAWL_API_KEY=xxx OPENAI_API_KEY=xxx node test-scrape.js
 */

const API_BASE = process.env.API_BASE || 'https://heirclark-fitness.up.railway.app';

async function testScrapeStatus() {
  console.log('\n=== Testing Scrape Status ===');

  try {
    const res = await fetch(`${API_BASE}/api/v1/scrape/status`);
    const data = await res.json();

    console.log('Status:', res.status);
    console.log('Response:', JSON.stringify(data, null, 2));

    if (data.data?.configured) {
      console.log('✓ Scraping service is configured');
    } else {
      console.log('⚠ Scraping service is NOT configured');
      console.log('  Missing:', data.data?.message);
    }

    return data.data?.configured;
  } catch (error) {
    console.error('✗ Error:', error.message);
    return false;
  }
}

async function testScrapeRecipe() {
  console.log('\n=== Testing Recipe Scrape ===');

  // Test with a real recipe URL (AllRecipes example)
  const testUrl = 'https://www.allrecipes.com/recipe/10813/best-chocolate-chip-cookies/';

  try {
    const res = await fetch(`${API_BASE}/api/v1/scrape`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: testUrl,
        type: 'recipe',
        useCache: true,
      }),
    });

    const data = await res.json();

    console.log('Status:', res.status);

    if (res.ok) {
      console.log('✓ Recipe scraped successfully');
      console.log('Cached:', data.data?.cached);
      console.log('Title:', data.data?.extractedData?.title);
      console.log('Macros:', JSON.stringify(data.data?.extractedData?.macros, null, 2));
      console.log('Ingredients count:', data.data?.extractedData?.ingredients?.length || 0);
    } else {
      console.log('✗ Scrape failed:', data.error);
    }

    return res.ok;
  } catch (error) {
    console.error('✗ Error:', error.message);
    return false;
  }
}

async function testScrapeLookup() {
  console.log('\n=== Testing Scrape Lookup (Cache Check) ===');

  const testUrl = 'https://www.allrecipes.com/recipe/10813/best-chocolate-chip-cookies/';

  try {
    const res = await fetch(`${API_BASE}/api/v1/scrape/lookup?url=${encodeURIComponent(testUrl)}`);
    const data = await res.json();

    console.log('Status:', res.status);
    console.log('Found in cache:', data.data?.found);

    if (data.data?.found) {
      console.log('✓ URL found in cache');
      console.log('Cached at:', data.data?.scrape?.createdAt);
    } else {
      console.log('⚠ URL not in cache');
    }

    return res.ok;
  } catch (error) {
    console.error('✗ Error:', error.message);
    return false;
  }
}

async function testRecentScrapes() {
  console.log('\n=== Testing Recent Scrapes ===');

  try {
    const res = await fetch(`${API_BASE}/api/v1/scrape/recent?type=recipe&limit=5`);
    const data = await res.json();

    console.log('Status:', res.status);
    console.log('Count:', data.data?.count);

    if (data.data?.scrapes?.length > 0) {
      console.log('✓ Recent scrapes found');
      data.data.scrapes.forEach((s, i) => {
        console.log(`  ${i + 1}. ${s.extractedData?.title || 'Unknown'} (${s.type})`);
      });
    } else {
      console.log('⚠ No recent scrapes found');
    }

    return res.ok;
  } catch (error) {
    console.error('✗ Error:', error.message);
    return false;
  }
}

async function testInvalidUrl() {
  console.log('\n=== Testing Invalid URL Handling ===');

  try {
    const res = await fetch(`${API_BASE}/api/v1/scrape`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'not-a-valid-url',
        type: 'recipe',
      }),
    });

    const data = await res.json();

    console.log('Status:', res.status);

    if (res.status === 400) {
      console.log('✓ Invalid URL correctly rejected');
      console.log('Error:', data.error);
    } else {
      console.log('✗ Expected 400 status for invalid URL');
    }

    return res.status === 400;
  } catch (error) {
    console.error('✗ Error:', error.message);
    return false;
  }
}

async function testBlockedUrl() {
  console.log('\n=== Testing Blocked URL (localhost) ===');

  try {
    const res = await fetch(`${API_BASE}/api/v1/scrape`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'http://localhost:3000/secret',
        type: 'recipe',
      }),
    });

    const data = await res.json();

    console.log('Status:', res.status);

    if (res.status === 400) {
      console.log('✓ Internal URL correctly blocked');
      console.log('Error:', data.error);
    } else {
      console.log('✗ Expected 400 status for internal URL');
    }

    return res.status === 400;
  } catch (error) {
    console.error('✗ Error:', error.message);
    return false;
  }
}

async function testBatchScrape() {
  console.log('\n=== Testing Batch Scrape ===');

  const urls = [
    { url: 'https://www.allrecipes.com/recipe/10813/best-chocolate-chip-cookies/', type: 'recipe' },
    { url: 'https://www.allrecipes.com/recipe/24074/alton-browns-guacamole/', type: 'recipe' },
  ];

  try {
    const res = await fetch(`${API_BASE}/api/v1/scrape/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls }),
    });

    const data = await res.json();

    console.log('Status:', res.status);

    if (res.ok) {
      console.log('✓ Batch scrape completed');
      console.log('Total:', data.data?.total);
      console.log('Successful:', data.data?.successful);
      data.data?.results?.forEach((r, i) => {
        console.log(`  ${i + 1}. ${r.url}: ${r.success ? '✓' : '✗ ' + r.error}`);
      });
    } else {
      console.log('✗ Batch scrape failed:', data.error);
    }

    return res.ok;
  } catch (error) {
    console.error('✗ Error:', error.message);
    return false;
  }
}

// Main test runner
async function runTests() {
  console.log('========================================');
  console.log('  Firecrawl Scraping Integration Tests');
  console.log('========================================');
  console.log('API Base:', API_BASE);

  const results = {
    status: await testScrapeStatus(),
    invalidUrl: await testInvalidUrl(),
    blockedUrl: await testBlockedUrl(),
    lookup: await testScrapeLookup(),
    recent: await testRecentScrapes(),
  };

  // Only run actual scraping tests if service is configured
  if (results.status) {
    results.recipe = await testScrapeRecipe();
    results.batch = await testBatchScrape();
  } else {
    console.log('\n⚠ Skipping scrape tests (service not configured)');
    results.recipe = null;
    results.batch = null;
  }

  // Summary
  console.log('\n========================================');
  console.log('  Test Summary');
  console.log('========================================');

  let passed = 0;
  let failed = 0;
  let skipped = 0;

  Object.entries(results).forEach(([name, result]) => {
    if (result === null) {
      console.log(`  ○ ${name}: SKIPPED`);
      skipped++;
    } else if (result) {
      console.log(`  ✓ ${name}: PASSED`);
      passed++;
    } else {
      console.log(`  ✗ ${name}: FAILED`);
      failed++;
    }
  });

  console.log(`\n  Total: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  console.log('========================================\n');

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(console.error);
