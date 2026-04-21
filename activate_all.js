import { db } from "./src/config/firebase.js";

async function activateAll() {
  console.log("Searching for all businesses (Global Search)...");
  
  // collectionGroup ignores the user ID and finds all businesses
  const businessesSnap = await db.collectionGroup("businesses").get();
  console.log(`Found ${businessesSnap.size} businesses in total.`);
  
  let count = 0;
  for (const bizDoc of businessesSnap.docs) {
    const oneYearFromNow = new Date();
    oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);
    
    await bizDoc.ref.update({
      status: "active",
      expiryDate: oneYearFromNow
    });
    console.log(`  Activated: ${bizDoc.data().name}`);
    count++;
  }
  
  console.log(`\nSuccess! Activated ${count} businesses.`);
  process.exit(0);
}

activateAll().catch(e => {
  console.error("Failed:", e);
  process.exit(1);
});
