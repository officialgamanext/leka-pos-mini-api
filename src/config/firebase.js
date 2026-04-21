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

    // Use environment variable if available (Recommended for Vercel)
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    } else {
      // Fallback for local development
      const certPath = path.resolve(__dirname, "../../service-account.json");
      if (fs.existsSync(certPath)) {
        serviceAccount = JSON.parse(fs.readFileSync(certPath, "utf8"));
      }
    }

    if (!serviceAccount) {
      throw new Error("Firebase Service Account configuration missing.");
    }

    // Fix private key formatting for Vercel
    if (serviceAccount.private_key) {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
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
