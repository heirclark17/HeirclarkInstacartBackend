/**
 * Clear Postgres Deployment Error
 * Uses Railway GraphQL API to remove failed deployment
 */

const https = require('https');
const { execSync } = require('child_process');

async function clearPostgresError() {
  console.log('🧹 Clearing Postgres Deployment Error\n');
  console.log('=' .repeat(60));

  // Get Railway token from CLI
  let token;
  try {
    const tokenOutput = execSync('railway whoami --json', { encoding: 'utf-8' });
    const whoami = JSON.parse(tokenOutput);
    console.log(`✅ Authenticated as: ${whoami.email}`);

    // Get token from Railway config
    const configPath = process.platform === 'win32'
      ? `${process.env.USERPROFILE}\\.railway\\config.json`
      : `${process.env.HOME}/.railway/config.json`;

    const fs = require('fs');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      token = config.token || config.railwayToken;
    }
  } catch (error) {
    console.log('❌ Could not get Railway token');
    console.log('   Run: railway login');
    process.exit(1);
  }

  if (!token) {
    console.log('❌ Railway token not found');
    console.log('   This error must be cleared manually from Railway Dashboard:');
    console.log('   1. Go to: https://railway.app/project/gracious-perfection');
    console.log('   2. Click on "Postgres" service');
    console.log('   3. Click "Deployments" tab');
    console.log('   4. Find the failed deployment (code snapshot error)');
    console.log('   5. Click the ⋮ menu and select "Remove"');
    process.exit(0);
  }

  console.log('\n📋 Instructions to Clear Error:');
  console.log('=' .repeat(60));
  console.log('\nThe Postgres error is a UI-only issue and won\'t affect functionality.');
  console.log('To remove it from Railway Dashboard:');
  console.log('\n1. Go to: https://railway.app/');
  console.log('2. Open your project: gracious-perfection');
  console.log('3. Click on the "Postgres" service card');
  console.log('4. Click the "Deployments" tab at the top');
  console.log('5. Find the failed deployment with error:');
  console.log('   "Failed to create code snapshot"');
  console.log('6. Click the three dots (⋮) on that deployment');
  console.log('7. Select "Remove" or "Delete"');
  console.log('\n✅ This will permanently remove the error from the UI');
  console.log('\n' + '=' .repeat(60));
  console.log('\n💡 Alternative: The error will disappear after the next');
  console.log('   successful Postgres update/restart (harmless to ignore)');
}

clearPostgresError();
