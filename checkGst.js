import { db } from "./src/config/firebase.js";

async function checkGst() {
  console.log("Checking last 5 bills for GST data...");
  
  // We need to find bills across all users and businesses
  // Firestore doesn't support recursive listing well, 
  // but we can use collectionGroup if we have index, or just iterate.
  
  const usersSnap = await db.collection("users").get();
  
  for (const userDoc of usersSnap.docs) {
    const bizSnap = await db.collection(`users/${userDoc.id}/businesses`).get();
    
    for (const bizDoc of bizSnap.docs) {
      const billsSnap = await db.collection(`users/${userDoc.id}/businesses/${bizDoc.id}/bills`)
        .orderBy("createdAt", "desc")
        .limit(3)
        .get();
      
      if (!billsSnap.empty) {
        console.log(`\nBusiness: ${bizDoc.data().name || bizDoc.id} (${bizDoc.id})`);
        billsSnap.forEach(doc => {
          const data = doc.data();
          console.log(`- Bill ${doc.id}: Total=${data.total}, GST=${data.gstAmount}, Rate=${data.gstRate}, Created=${data.createdAt?.toDate().toISOString()}`);
        });
      }
    }
  }
  process.exit(0);
}

checkGst().catch(console.error);
