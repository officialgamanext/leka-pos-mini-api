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
    let serviceAccount;

    // 1. Check for individual environment variables (Best for Vercel/Production)
    if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
      serviceAccount = {
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
      };
      console.log("🛠️ Using individual Firebase Env Vars");
    } 
    // 2. Fallback to full JSON string
    else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      if (serviceAccount.private_key) {
        serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
      }
      console.log("🛠️ Using full FIREBASE_SERVICE_ACCOUNT JSON");
    } 
    // 3. Fallback to local file
    else {
      const certPath = path.resolve(__dirname, "../../service-account.json");
      if (fs.existsSync(certPath)) {
        serviceAccount = JSON.parse(fs.readFileSync(certPath, "utf8"));
      }
    }

    if (!serviceAccount) {
      throw new Error("Firebase Service Account configuration missing. Please set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY.");
    }

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    
    db = getFirestore();
    console.log("✅ Firebase Admin & Firestore initialized successfully.");
  } catch (error) {
    console.error("❌ Firebase Init Error:", error.message);
    // Don't process.exit(1) on Vercel, as it causes a loop. 
    // Instead, we throw it so Vercel can log it properly.
    if (process.env.NODE_ENV === "production") throw error;
    process.exit(1);
  }
} else {
  db = getFirestore();
}

export { db, FieldValue };
