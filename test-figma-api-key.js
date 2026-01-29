/**
 * Standalone Figma API Health Check
 * Tests if FIGMA_API_KEY is valid without needing the full backend
 */

require('dotenv').config();

const FIGMA_API_KEY = process.env.FIGMA_API_KEY;

async function testFigmaAPI() {
  console.log('🧪 Testing Figma API Connection\n');
  console.log('=' .repeat(60));

  // Check if API key is configured
  if (!FIGMA_API_KEY) {
    console.log('❌ FIGMA_API_KEY is NOT configured');
    console.log('\nTo fix:');
    console.log('1. Add to .env file: FIGMA_API_KEY=figd_YOUR_TOKEN');
    console.log('2. Or set in Railway: Variables → Add FIGMA_API_KEY');
    console.log('3. Get your token from: https://www.figma.com/developers/api#access-tokens');
    process.exit(1);
  }

  console.log('✅ FIGMA_API_KEY is configured');
  console.log(`   Length: ${FIGMA_API_KEY.length} characters`);
  console.log(`   Prefix: ${FIGMA_API_KEY.substring(0, 10)}...`);

  // Test API connection
  console.log('\n📡 Testing Figma API connection...');

  try {
    const response = await fetch('https://api.figma.com/v1/me', {
      headers: {
        'X-Figma-Token': FIGMA_API_KEY,
      },
    });

    console.log(`   Status: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      if (response.status === 403) {
        console.log('\n❌ API Key is INVALID or has insufficient permissions');
        console.log('\nTo fix:');
        console.log('1. Go to: https://www.figma.com/developers/api#access-tokens');
        console.log('2. Generate a new Personal Access Token');
        console.log('3. Make sure "File content" permission is enabled');
        console.log('4. Update FIGMA_API_KEY with the new token');
        process.exit(1);
      }

      throw new Error(`Figma API returned ${response.status}`);
    }

    const data = await response.json();

    console.log('\n✅ Figma API Connection SUCCESSFUL!');
    console.log('\n📋 Account Details:');
    console.log(`   Email: ${data.email || 'N/A'}`);
    console.log(`   Name: ${data.handle || 'N/A'}`);
    console.log(`   ID: ${data.id || 'N/A'}`);

    console.log('\n' + '='.repeat(60));
    console.log('🎉 FIGMA API IS READY TO USE!');
    console.log('=' .repeat(60));

    console.log('\n📚 Available Backend Endpoints:');
    console.log('   GET /api/v1/figma/health              - Health check');
    console.log('   GET /api/v1/figma/file/:fileKey       - Get Figma file');
    console.log('   GET /api/v1/figma/nodes/:fileKey      - Get specific nodes');
    console.log('   GET /api/v1/figma/images/:fileKey     - Export images');
    console.log('   GET /api/v1/figma/styles/:fileKey     - Get styles');
    console.log('   GET /api/v1/figma/colors/:fileKey     - Extract colors');
    console.log('   GET /api/v1/figma/comments/:fileKey   - Get comments');

    console.log('\n💡 Next Steps:');
    console.log('   1. Create your designs in Figma');
    console.log('   2. Get the file key from URL: figma.com/file/{FILE_KEY}/...');
    console.log('   3. Use backend API to fetch design data');

    process.exit(0);

  } catch (error) {
    console.log('\n❌ API Connection Failed');
    console.log(`   Error: ${error.message}`);
    process.exit(1);
  }
}

// Run the test
testFigmaAPI();
