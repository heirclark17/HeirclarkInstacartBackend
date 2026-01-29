/**
 * Fetch Figma Designs - Interactive Script
 * Demonstrates all Figma API endpoints
 */

const BACKEND_URL = 'https://heirclarkinstacartbackend-production.up.railway.app';
const CUSTOMER_ID = 'demo-user-123'; // Replace with actual customer ID

// IMPORTANT: Add your Figma file key here
const FIGMA_FILE_KEY = process.argv[2] || '';

if (!FIGMA_FILE_KEY) {
  console.log('\n❌ No Figma file key provided!');
  console.log('\n📋 How to get your Figma file key:');
  console.log('   1. Open Figma (https://figma.com)');
  console.log('   2. Create or open any file');
  console.log('   3. Copy the file key from the URL:');
  console.log('      https://www.figma.com/file/ABC123XYZ/My-Design');
  console.log('                                 ↑↑↑↑↑↑↑↑↑');
  console.log('                               File Key');
  console.log('\n💡 Usage:');
  console.log('   node fetch-figma-designs.js YOUR_FILE_KEY');
  console.log('\n📖 Example:');
  console.log('   node fetch-figma-designs.js Ukg3ZxMBvqRXr9M7RN8P2o');
  process.exit(1);
}

async function fetchFigmaDesigns() {
  console.log('\n🎨 Fetching Figma Designs');
  console.log('='.repeat(60));
  console.log(`File Key: ${FIGMA_FILE_KEY}`);
  console.log(`Backend: ${BACKEND_URL}`);
  console.log('='.repeat(60));

  // Test 1: Health Check
  console.log('\n1️⃣  Testing API Health...');
  try {
    const healthRes = await fetch(`${BACKEND_URL}/api/v1/figma/health`);
    const health = await healthRes.json();
    console.log(`   Status: ${health.status}`);
    console.log(`   ${health.message}`);
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    process.exit(1);
  }

  // Test 2: Get Complete File
  console.log('\n2️⃣  Fetching Complete Figma File...');
  try {
    const fileRes = await fetch(
      `${BACKEND_URL}/api/v1/figma/file/${FIGMA_FILE_KEY}`,
      { headers: { 'X-Shopify-Customer-Id': CUSTOMER_ID } }
    );

    if (!fileRes.ok) {
      const error = await fileRes.json();
      console.log(`   ❌ Error ${fileRes.status}: ${error.error}`);
      console.log('\n💡 Note: This endpoint requires backend authentication.');
      console.log('   For testing, you can use the Figma API directly:');
      console.log(`   https://api.figma.com/v1/files/${FIGMA_FILE_KEY}`);
    } else {
      const file = await fileRes.json();
      console.log(`   ✅ File Name: ${file.data.name}`);
      console.log(`   📅 Last Modified: ${file.data.lastModified}`);
      console.log(`   🔢 Version: ${file.data.version}`);
      console.log(`   📦 Components: ${Object.keys(file.data.components || {}).length}`);
      console.log(`   🎨 Styles: ${Object.keys(file.data.styles || {}).length}`);

      // Save to file
      const fs = require('fs');
      fs.writeFileSync('figma-file-data.json', JSON.stringify(file.data, null, 2));
      console.log('   💾 Saved to: figma-file-data.json');
    }
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
  }

  // Test 3: Extract Color Palette
  console.log('\n3️⃣  Extracting Color Palette...');
  try {
    const colorsRes = await fetch(
      `${BACKEND_URL}/api/v1/figma/colors/${FIGMA_FILE_KEY}`,
      { headers: { 'X-Shopify-Customer-Id': CUSTOMER_ID } }
    );

    if (!colorsRes.ok) {
      const error = await colorsRes.json();
      console.log(`   ❌ Error ${colorsRes.status}: ${error.error}`);
    } else {
      const colors = await colorsRes.json();
      console.log(`   ✅ Found ${colors.data.count} unique colors:`);
      colors.data.colors.forEach((color, i) => {
        console.log(`   ${i + 1}. ${color}`);
      });
    }
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
  }

  // Test 4: Get File Styles
  console.log('\n4️⃣  Fetching File Styles...');
  try {
    const stylesRes = await fetch(
      `${BACKEND_URL}/api/v1/figma/styles/${FIGMA_FILE_KEY}`,
      { headers: { 'X-Shopify-Customer-Id': CUSTOMER_ID } }
    );

    if (!stylesRes.ok) {
      const error = await stylesRes.json();
      console.log(`   ❌ Error ${stylesRes.status}: ${error.error}`);
    } else {
      const styles = await stylesRes.json();
      const styleCount = Object.keys(styles.data.styles || {}).length;
      console.log(`   ✅ Found ${styleCount} styles`);

      if (styleCount > 0) {
        Object.values(styles.data.styles).slice(0, 5).forEach((style, i) => {
          console.log(`   ${i + 1}. ${style.name} (${style.styleType})`);
        });
        if (styleCount > 5) {
          console.log(`   ... and ${styleCount - 5} more`);
        }
      }
    }
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
  }

  // Test 5: Direct Figma API Access (Bypass Backend)
  console.log('\n5️⃣  Testing Direct Figma API Access...');
  console.log('   (This bypasses backend auth - uses Figma token directly)');

  // Note: This would require the FIGMA_API_KEY which is server-side only
  console.log('   ℹ️  Direct API access requires server-side token');
  console.log('   ℹ️  Use backend endpoints for authenticated requests');

  console.log('\n' + '='.repeat(60));
  console.log('✅ Design Fetch Complete!');
  console.log('='.repeat(60));

  console.log('\n📝 Summary:');
  console.log('   - Health check: Working');
  console.log('   - File data: Check figma-file-data.json (if created)');
  console.log('   - Colors: Extracted from design');
  console.log('   - Styles: Listed above');

  console.log('\n💡 Next Steps:');
  console.log('   1. Review figma-file-data.json for complete file structure');
  console.log('   2. Use extracted colors in your frontend CSS');
  console.log('   3. Export specific components as images');
  console.log('   4. See FIGMA-API-DOCUMENTATION.md for more endpoints');
}

// Run the script
fetchFigmaDesigns().catch(error => {
  console.error('\n❌ Fatal Error:', error.message);
  process.exit(1);
});
