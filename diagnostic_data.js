import { db } from "./src/config/firebase.js";

async function diagnose() {
  console.log("Checking Users...");
  const users = await db.collection("users").get();
  console.log(`Users found: ${users.size}`);
  users.forEach(u => console.log(` - ${u.id}: ${u.data().email || u.data().name}`));

  console.log("\nChecking Businesses (Collection Group)...");
  const biz = await db.collectionGroup("businesses").get();
  console.log(`Businesses found: ${biz.size}`);
  biz.forEach(b => console.log(` - ${b.id}: ${b.data().name} (Owner: ${b.ref.parent.parent.id})`));
}

diagnose().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
