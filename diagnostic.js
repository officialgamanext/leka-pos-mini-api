import { db } from "./src/config/firebase.js";

async function diagnostic() {
  console.log("Listing root collections...");
  const collections = await db.listCollections();
  collections.forEach(c => console.log("Root collection:", c.id));
  
  const usersSnap = await db.collection("users").limit(5).get();
  console.log("Users found:", usersSnap.size);
  
  for (const userDoc of usersSnap.docs) {
    console.log("User ID:", userDoc.id);
    const sub = await userDoc.ref.listCollections();
    sub.forEach(sc => console.log(`  Sub-collection under user ${userDoc.id}:`, sc.id));
  }
  process.exit(0);
}

diagnostic();
