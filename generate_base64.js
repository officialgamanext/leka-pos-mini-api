import fs from 'fs';

const jsonPath = './service-account.json';

if (fs.existsSync(jsonPath)) {
  const account = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const privateKey = account.private_key;
  
  // Convert the PEM key to a Base64 string
  const base64Key = Buffer.from(privateKey).toString('base64');
  
  console.log('\n--- COPY THE KEY BELOW ---');
  console.log(base64Key);
  console.log('--- END OF KEY ---\n');
  
  console.log('Instructions:');
  console.log('1. Copy the long string above.');
  console.log('2. Add it to Vercel as: FIREBASE_PRIVATE_KEY_BASE64');
} else {
  console.error('❌ service-account.json not found');
}
