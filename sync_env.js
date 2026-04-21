import fs from 'fs';
import path from 'path';

const jsonPath = './service-account.json';
const envPath = './.env';

if (fs.existsSync(jsonPath)) {
  const account = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  let envContent = fs.readFileSync(envPath, 'utf8');

  // Remove old Firebase vars if they exist
  envContent = envContent.split('\n').filter(line => 
    !line.startsWith('FIREBASE_PROJECT_ID=') && 
    !line.startsWith('FIREBASE_CLIENT_EMAIL=') && 
    !line.startsWith('FIREBASE_PRIVATE_KEY=')
  ).join('\n');

  // Prepare the clean private key. 
  // IMPORTANT: We use literal \n strings here because the code uses .replace(/\\n/g, '\n')
  const cleanKey = account.private_key.replace(/\n/g, '\\n');

  const newVars = `
FIREBASE_PROJECT_ID=${account.project_id}
FIREBASE_CLIENT_EMAIL=${account.client_email}
FIREBASE_PRIVATE_KEY="${cleanKey}"
`;

  fs.writeFileSync(envPath, envContent.trim() + newVars);
  console.log('✅ .env file synchronized perfectly with service-account.json');
} else {
  console.error('❌ service-account.json not found');
}
