import { db } from "./src/config/firebase.js";

async function activateAllBusinesses() {
  console.log("Starting business activation...");
  const usersSnap = await db.collection("users").get();
  
  let count = 0;
  for (const userDoc of usersSnap.docs) {
    const businessesSnap = await db.collection(`users/${userDoc.id}/businesses`).get();
    
    for (const bizDoc of businessesSnap.docs) {
      const oneYearFromNow = new Date();
      oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);
      
      await bizDoc.ref.update({
        status: "active",
        expiryDate: oneYearFromNow
      });
      console.log(`Activated business: ${bizDoc.data().name} (${bizDoc.id})`);
      count++;
    }
  }
  console.log(`Finished! Activated ${count} businesses.`);
  process.exit(0);
}

activateAllBusinesses().catch(err => {
  console.error("Migration failed:", err);
  process.exit(1);
});
