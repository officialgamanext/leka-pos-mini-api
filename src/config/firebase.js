import admin from "firebase-admin";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// We define db here but initialize it only if app exists
let db;

if (!admin.apps.length) {
  try {
    const certPath = path.resolve(__dirname, "../../service-account.json");
    const rawData = fs.readFileSync(certPath, "utf8");
    const serviceAccount = JSON.parse(rawData);

    if (serviceAccount.private_key) {
      // THE FIX: 
      // 1. Remove ALL types of white space and literal backslash-n sequences
      let cleanKey = serviceAccount.private_key
        .replace(/\\n/g, '')  // remove literal \n
        .replace(/\n/g, '')    // remove actual newlines
        .replace(/\s+/g, '');  // remove all spaces/tabs

      // 2. Extract the base64 part between the headers
      const header = "-----BEGIN PRIVATE KEY-----";
      const footer = "-----END PRIVATE KEY-----";
      
      const base64Body = cleanKey
        .replace(header.replace(/\s+/g, ''), '')
        .replace(footer.replace(/\s+/g, ''), '');

      // 3. Reconstruct with exactly one newline after header and before footer
      serviceAccount.private_key = `${header}\n${base64Body}\n${footer}\n`;
    }

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    
    db = getFirestore();
    console.log("✅ Firebase Admin & Firestore initialized successfully.");
  } catch (error) {
    console.error("❌ Failed to initialize Firebase Admin:", error.message);
    // Exit the process so nodemon can wait for your fix
    process.exit(1); 
  }
} else {
  db = getFirestore();
}

export { db, FieldValue };
