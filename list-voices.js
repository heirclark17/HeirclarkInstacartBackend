// List available voices from LiveAvatar API
const https = require('https');

const API_KEY = process.env.HEYGEN_API_KEY;

if (!API_KEY) {
  console.error('HEYGEN_API_KEY not set');
  process.exit(1);
}

console.log('Fetching voices from LiveAvatar API...\n');

const options = {
  hostname: 'api.liveavatar.com',
  path: '/v1/voices',
  method: 'GET',
  headers: {
    'X-API-KEY': API_KEY,
    'Content-Type': 'application/json',
  },
};

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => (data += chunk));
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    try {
      const json = JSON.parse(data);
      if (json.data && Array.isArray(json.data)) {
        console.log(`\nFound ${json.data.length} voices:\n`);
        json.data.forEach((v, i) => {
          console.log(`${i + 1}. ${v.name || v.voice_name || 'Unnamed'}`);
          console.log(`   ID: ${v.voice_id || v.id}`);
          console.log(`   Language: ${v.language || 'N/A'}`);
          console.log('');
        });
      } else {
        console.log('Response:', JSON.stringify(json, null, 2));
      }
    } catch (e) {
      console.log('Raw response:', data);
    }
  });
});

req.on('error', (e) => console.error('Error:', e.message));
req.end();
