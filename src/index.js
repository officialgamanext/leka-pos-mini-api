import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { db, FieldValue } from "./config/firebase.js";
import { authMiddleware } from "./middleware/auth.js";
import { getDateRange } from "./helpers/dateRange.js";
import { format } from "date-fns";
import ImageKit from "imagekit";
import NodeCache from "node-cache";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Initialize ImageKit
const imagekit = new ImageKit({
  publicKey: process.env.IMAGEKIT_PUBLIC_KEY || "your_public_key",
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY || "your_private_key",
  urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT || "https://ik.imagekit.io/your_imagekit_id"
});

// Initialize Cache (Path cache: 5 mins, Data cache: 1 hour)
const apiCache = new NodeCache({ stdTTL: 3600, checkperiod: 120 });

app.use(cors());
app.use(express.json());

// Cache Helpers
const getCacheKey = (type, bizId) => `${type}_${bizId}`;
const clearBizCache = (bizId) => {
  apiCache.del(getCacheKey("items", bizId));
  apiCache.del(getCacheKey("categories", bizId));
  console.log(`[Cache] Cleared data for business: ${bizId}`);
};


// ─────────────────────────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Resolve the Firestore path for a business.
 *  Owners:  users/{ownerId}/businesses/{businessId}
 *  Staff :  same path but the ownerId is stored in the business doc
 */
/** 
 * Resolve the Firestore path for a business and check subscription status. 
 * Returns { ownerId, businessId } or throws an error if inactive/expired.
 */
async function resolveBusinessPath(userId, userMobile, businessId) {
  const cacheKey = `path_${userId}_${businessId}`;
  const cached = apiCache.get(cacheKey);
  
  const now = new Date();

  // If cached, verify the subscription status before returning
  if (cached) {
    const { ownerId, status, expiryDate } = cached;
    const expiry = expiryDate ? new Date(expiryDate) : null;

    if (status !== "active") {
      throw new Error("Business access is disabled. Please contact the owner or administrator.");
    }
    if (!expiry || expiry < now) {
      throw new Error("Business subscription has expired. Access locked.");
    }
    return { ownerId, businessId };
  }

  let foundBiz = null;
  let ownerId = userId;

  // 1. Check if user owns it
  const ownerRef = db.doc(`users/${userId}/businesses/${businessId}`);
  const ownerSnap = await ownerRef.get();
  
  if (ownerSnap.exists) {
    foundBiz = ownerSnap.data();
  } else if (userMobile) {
    // 2. Optimized Search (Fast)
    const cleanLogged = userMobile.replace(/\D/g, "").slice(-10);
    const staffSnap = await db.collectionGroup("staff")
      .where("cleanMobile", "==", cleanLogged)
      .where("businessId", "==", businessId)
      .limit(1)
      .get();

    if (!staffSnap.empty) {
      const staffDoc = staffSnap.docs[0];
      ownerId = staffDoc.ref.parent.parent.parent.parent.id;
      const bizRef = staffDoc.ref.parent.parent;
      const bizSnap = await bizRef.get();
      if (bizSnap.exists) foundBiz = bizSnap.data();
    }
  }

  if (!foundBiz) return null;

  // 3. STRICT SECURITY CHECK
  const expiry = foundBiz.expiryDate ? foundBiz.expiryDate.toDate() : null;

  if (foundBiz.status !== "active") {
    throw new Error("Business access is disabled. Please contact the owner or administrator.");
  }

  if (!expiry || expiry < now) {
    throw new Error("Business subscription has expired. Access locked.");
  }

  const result = { 
    ownerId, 
    businessId, 
    status: foundBiz.status, 
    expiryDate: expiry ? expiry.toISOString() : null 
  };
  
  // Cache for 5 minutes
  apiCache.set(cacheKey, result, 300);
  return { ownerId, businessId };
}

/** Return all businesses visible to a user (own + as staff) */
async function getAccessibleBusinesses(userId, userMobile) {
  const results = [];

  // 1. Own businesses
  const ownSnap = await db.collection(`users/${userId}/businesses`).get();
  for (const doc of ownSnap.docs) {
    const bizData = doc.data();
    // Check expiry for UI label
    const isExpired = bizData.expiryDate ? bizData.expiryDate.toDate() < new Date() : true;

    results.push({ 
      id: doc.id, 
      ...bizData, 
      role: "owner",
      isExpired,
      statusLabel: bizData.status === "active" ? (isExpired ? "Expired" : "Active") : "Inactive"
    });
  }

  // 2. Staff businesses (Optimized Query)
  if (userMobile) {
    const cleanLogged = userMobile.replace(/\D/g, "").slice(-10);
    const staffSnap = await db.collectionGroup("staff")
      .where("cleanMobile", "==", cleanLogged)
      .get();

    for (const staffDoc of staffSnap.docs) {
      const bizRef = staffDoc.ref.parent.parent;
      const bizSnap = await bizRef.get();
      if (bizSnap.exists) {
        const ownerId = bizRef.parent.parent.id;
        const bizData = bizSnap.data();
        const isExpired = bizData.expiryDate ? bizData.expiryDate.toDate() < new Date() : true;

        results.push({ 
          id: bizSnap.id, 
          ...bizData, 
          role: staffDoc.data().role || "staff",
          isExpired,
          statusLabel: bizData.status === "active" ? (isExpired ? "Expired" : "Active") : "Inactive"
        });
      }
    }
  }

  return results;
}


// ─────────────────────────────────────────────────────────────────────────────
//  BUSINESS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/business  — Create a Business (owner)
 */
app.post("/api/business", authMiddleware, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: "Business name is required" });

    const userId = req.user.userId;
    const userMobile = req.user.phoneNumber || req.user.phone;

    // Set expiry to yesterday (makes it expired by default)
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    const businessRef = db.collection(`users/${userId}/businesses`);
    const newBusiness = await businessRef.add({
      name,
      ownerId: userId,
      ownerMobile: userMobile,
      status: "active",       // Allow them to see the landing, but expired
      expiryDate: yesterday, // Expired by default
      createdAt: FieldValue.serverTimestamp()
    });

    res.status(201).json({ 
      id: newBusiness.id, 
      name, 
      role: "owner", 
      status: "active", 
      message: "Business created. Please renew subscription to start billing." 
    });
  } catch (err) {
    console.error("Error creating business:", err);
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

/**
 * GET /api/businesses  — List all businesses (owned + staff)
 */
app.get("/api/businesses", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    // Handle different possible field names for phone from Descope
    const userMobile = req.user.phoneNumber || req.user.phone || req.user.phone_number;
    
    const businesses = await getAccessibleBusinesses(userId, userMobile);
    res.status(200).json(businesses);
  } catch (err) {
    console.error("Error fetching businesses:", err);
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});


// ─────────────────────────────────────────────────────────────────────────────
//  STAFF MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/staff  — Add a staff member by Mobile Number
 * Body: { businessId, mobileNumber, name, role }
 */
app.post("/api/staff", authMiddleware, async (req, res) => {
  try {
    const { businessId, mobileNumber, name, role = "staff" } = req.body;
    const userId = req.user.userId;

    if (!businessId || !mobileNumber || !name) {
      return res.status(400).json({ error: "businessId, mobileNumber, and name are required" });
    }

    // Verify ownership
    const bizRef = db.doc(`users/${userId}/businesses/${businessId}`);
    const bizSnap = await bizRef.get();
    if (!bizSnap.exists) {
      return res.status(403).json({ error: "Only business owners can add staff" });
    }

    const staffRef = db.collection(`users/${userId}/businesses/${businessId}/staff`);
    
    // SPEED OPTIMIZATION: Clean mobile for indexing
    const cleanMobile = mobileNumber.replace(/\D/g, "").slice(-10);

    // Check if duplicate mobile in this business
    const existing = await staffRef.where("cleanMobile", "==", cleanMobile).limit(1).get();
    if (!existing.empty) {
      return res.status(409).json({ error: "This mobile number is already added as staff" });
    }

    const newStaff = await staffRef.add({
      mobileNumber,
      cleanMobile, // Store cleaned version for fast queries
      name,
      businessId,
      role,
      addedAt: FieldValue.serverTimestamp()
    });

    res.status(201).json({ id: newStaff.id, message: "Staff added" });
  } catch (err) {
    console.error("Error adding staff:", err);
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

/**
 * GET /api/staff?businessId=…  — List staff members
 */
app.get("/api/staff", authMiddleware, async (req, res) => {
  try {
    const { businessId } = req.query;
    const userId = req.user.userId;

    if (!businessId) return res.status(400).json({ error: "businessId is required" });

    const bizRef = db.doc(`users/${userId}/businesses/${businessId}`);
    const bizSnap = await bizRef.get();
    if (!bizSnap.exists) {
      return res.status(403).json({ error: "Not authorised" });
    }

    const staffSnap = await db.collection(`users/${userId}/businesses/${businessId}/staff`).get();
    const staff = [];
    staffSnap.forEach(doc => staff.push({ id: doc.id, ...doc.data() }));

    res.status(200).json(staff);
  } catch (err) {
    if (err.message.includes("expired") || err.message.includes("disabled")) {
      return res.status(403).json({ error: "Access Denied", message: err.message });
    }
    console.error("Error fetching staff:", err);
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

/**
 * DELETE /api/staff/:staffId?businessId=…  — Remove a staff member
 */
app.delete("/api/staff/:staffId", authMiddleware, async (req, res) => {
  try {
    const { staffId } = req.params;
    const { businessId } = req.query;
    const userId = req.user.userId;

    if (!businessId) return res.status(400).json({ error: "businessId is required" });

    const bizRef = db.doc(`users/${userId}/businesses/${businessId}`);
    const bizSnap = await bizRef.get();
    if (!bizSnap.exists) {
      return res.status(403).json({ error: "Not authorised" });
    }

    await db.doc(`users/${userId}/businesses/${businessId}/staff/${staffId}`).delete();
    res.status(200).json({ message: "Staff member removed" });
  } catch (err) {
    if (err.message.includes("expired") || err.message.includes("disabled")) {
      return res.status(403).json({ error: "Access Denied", message: err.message });
    }
    console.error("Error removing staff:", err);
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});


// ─────────────────────────────────────────────────────────────────────────────
//  CATEGORIES
// ─────────────────────────────────────────────────────────────────────────────

app.post("/api/category", authMiddleware, async (req, res) => {
  try {
    const { businessId, name } = req.body;
    const userId = req.user.userId;
    const userMobile = req.user.phoneNumber || req.user.phone || req.user.phone_number;
    if (!businessId || !name) return res.status(400).json({ error: "businessId and name are required" });

    const path = await resolveBusinessPath(userId, userMobile, businessId);
    if (!path) return res.status(403).json({ error: "Not authorised" });

    apiCache.del(getCacheKey("categories", businessId)); // Clear cache

    const ref = db.collection(`users/${path.ownerId}/businesses/${path.businessId}/categories`);
    const doc = await ref.add({ name, createdAt: FieldValue.serverTimestamp() });
    res.status(201).json({ id: doc.id, message: "Category created" });
  } catch (err) {
    if (err.message.includes("expired") || err.message.includes("disabled")) {
      return res.status(403).json({ error: "Access Denied", message: err.message });
    }
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

app.get("/api/categories", authMiddleware, async (req, res) => {
  try {
    const { businessId } = req.query;
    const userId = req.user.userId;
    const userMobile = req.user.phoneNumber || req.user.phone || req.user.phone_number;
    if (!businessId) return res.status(400).json({ error: "businessId is required" });

    const path = await resolveBusinessPath(userId, userMobile, businessId);
    if (!path) return res.status(403).json({ error: "Not authorised" });

    const cacheKey = getCacheKey("categories", businessId);
    const cached = apiCache.get(cacheKey);
    if (cached) return res.status(200).json(cached);

    const snap = await db.collection(`users/${path.ownerId}/businesses/${path.businessId}/categories`).get();
    const data = [];
    snap.forEach(doc => data.push({ id: doc.id, ...doc.data() }));
    
    apiCache.set(cacheKey, data); // Store in cache
    res.status(200).json(data);
  } catch (err) {
    if (err.message.includes("expired") || err.message.includes("disabled")) {
      return res.status(403).json({ error: "Access Denied", message: err.message });
    }
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});


// ─────────────────────────────────────────────────────────────────────────────
//  ITEMS
// ─────────────────────────────────────────────────────────────────────────────

app.post("/api/item", authMiddleware, async (req, res) => {
  try {
    const { businessId, name, price, categoryId, imageUrl } = req.body;
    const userId = req.user.userId;
    const userMobile = req.user.phoneNumber || req.user.phone || req.user.phone_number;

    if (!businessId || !name || price === undefined) {
      return res.status(400).json({ error: "businessId, name, and price are required" });
    }

    const path = await resolveBusinessPath(userId, userMobile, businessId);
    if (!path) return res.status(403).json({ error: "Not authorised" });

    apiCache.del(getCacheKey("items", businessId)); // Clear cache

    let finalImageUrl = imageUrl || null;

    if (finalImageUrl && finalImageUrl.startsWith("data:image")) {
      try {
        const uploadResult = await imagekit.upload({
          file: finalImageUrl, 
          fileName: `item_${Date.now()}.jpg`,
          folder: "/leka-pos-mini"
        });
        finalImageUrl = uploadResult.url; 
      } catch (uploadErr) {
        console.error("ImageKit Upload Error:", uploadErr);
      }
    }

    const ref = db.collection(`users/${path.ownerId}/businesses/${path.businessId}/items`);
    const doc = await ref.add({
      name,
      price: parseFloat(price),
      categoryId: categoryId || null,
      imageUrl: finalImageUrl,
      createdAt: FieldValue.serverTimestamp()
    });
    res.status(201).json({ id: doc.id, message: "Item created", imageUrl: finalImageUrl });
  } catch (err) {
    if (err.message.includes("expired") || err.message.includes("disabled")) {
      return res.status(403).json({ error: "Access Denied", message: err.message });
    }
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

app.get("/api/items", authMiddleware, async (req, res) => {
  try {
    const { businessId } = req.query;
    const userId = req.user.userId;
    const userMobile = req.user.phoneNumber || req.user.phone || req.user.phone_number;
    if (!businessId) return res.status(400).json({ error: "businessId is required" });

    const path = await resolveBusinessPath(userId, userMobile, businessId);
    if (!path) return res.status(403).json({ error: "Not authorised" });

    const cacheKey = getCacheKey("items", businessId);
    const cached = apiCache.get(cacheKey);
    if (cached) return res.status(200).json(cached);

    const snap = await db.collection(`users/${path.ownerId}/businesses/${path.businessId}/items`).get();
    const data = [];
    snap.forEach(doc => data.push({ id: doc.id, ...doc.data() }));
    
    apiCache.set(cacheKey, data); // Store in cache
    res.status(200).json(data);
  } catch (err) {
    if (err.message.includes("expired") || err.message.includes("disabled")) {
      return res.status(403).json({ error: "Access Denied", message: err.message });
    }
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});


// ─────────────────────────────────────────────────────────────────────────────
//  BILLS
// ─────────────────────────────────────────────────────────────────────────────

app.post("/api/bill", authMiddleware, async (req, res) => {
  try {
    const { businessId, items, total, discount = 0, tax = 0, paymentMode = "Cash", paymentMethod } = req.body;
    const userId = req.user.userId;
    const userMobile = req.user.phoneNumber || req.user.phone || req.user.phone_number;

    if (!businessId || !items || total === undefined) {
      return res.status(400).json({ error: "businessId, items, and total are required" });
    }

    const path = await resolveBusinessPath(userId, userMobile, businessId);
    if (!path) return res.status(403).json({ error: "Not authorised" });

    const ref = db.collection(`users/${path.ownerId}/businesses/${path.businessId}/bills`);
    const doc = await ref.add({
      items,
      total: parseFloat(total),
      discount: parseFloat(discount),
      tax: parseFloat(tax),
      paymentMode: paymentMode !== "Cash" ? paymentMode : (paymentMethod || "Cash"),
      createdAt: FieldValue.serverTimestamp()
    });
    res.status(201).json({ id: doc.id, message: "Bill created" });
  } catch (err) {
    if (err.message.includes("expired") || err.message.includes("disabled")) {
      return res.status(403).json({ error: "Access Denied", message: err.message });
    }
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

app.get("/api/bills", authMiddleware, async (req, res) => {
  try {
    const { businessId, range = "today", startDate, endDate, limit: limitParam } = req.query;
    const userId = req.user.userId;
    const userMobile = req.user.phoneNumber || req.user.phone || req.user.phone_number;

    if (!businessId) return res.status(400).json({ error: "businessId is required" });

    const path = await resolveBusinessPath(userId, userMobile, businessId);
    if (!path) return res.status(403).json({ error: "Not authorised" });

    const { start, end } = getDateRange(range, startDate, endDate);
    const pageLimit = Math.min(parseInt(limitParam) || 50, 200);

    const snap = await db.collection(`users/${path.ownerId}/businesses/${path.businessId}/bills`)
      .where("createdAt", ">=", start)
      .where("createdAt", "<=", end)
      .orderBy("createdAt", "desc")
      .limit(pageLimit)
      .get();

    const bills = [];
    snap.forEach(doc => {
      const d = doc.data();
      bills.push({
        id: doc.id,
        ...d,
        createdAt: d.createdAt ? d.createdAt.toDate().toISOString() : null
      });
    });

    res.status(200).json(bills);
  } catch (err) {
    if (err.message.includes("expired") || err.message.includes("disabled")) {
      return res.status(403).json({ error: "Access Denied", message: err.message });
    }
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});


// ─────────────────────────────────────────────────────────────────────────────
//  INVESTMENTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/investment  — Add an investment/expense
 * Body: { businessId, title, amount, category?, note? }
 */
app.post("/api/investment", authMiddleware, async (req, res) => {
  try {
    const { businessId, title, amount, category = "General", note = "", date } = req.body;
    const userId = req.user.userId;
    const userMobile = req.user.phoneNumber || req.user.phone || req.user.phone_number;

    if (!businessId || !title || amount === undefined) {
      return res.status(400).json({ error: "businessId, title, and amount are required" });
    }

    const path = await resolveBusinessPath(userId, userMobile, businessId);
    if (!path) return res.status(403).json({ error: "Not authorised" });

    const investmentDate = date ? new Date(date) : new Date();

    const ref = db.collection(`users/${path.ownerId}/businesses/${path.businessId}/investments`);
    const doc = await ref.add({
      title,
      amount: parseFloat(amount),
      category,
      note,
      date: investmentDate,
      createdAt: FieldValue.serverTimestamp()
    });

    res.status(201).json({ id: doc.id, message: "Investment recorded" });
  } catch (err) {
    if (err.message.includes("expired") || err.message.includes("disabled")) {
      return res.status(403).json({ error: "Access Denied", message: err.message });
    }
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

/**
 * GET /api/investments?businessId=…&range=today|…|custom&startDate=&endDate=
 */
app.get("/api/investments", authMiddleware, async (req, res) => {
  try {
    const { businessId, range = "thisMonth", startDate, endDate } = req.query;
    const userId = req.user.userId;
    const userMobile = req.user.phoneNumber || req.user.phone || req.user.phone_number;
    if (!businessId) return res.status(400).json({ error: "businessId is required" });

    const path = await resolveBusinessPath(userId, userMobile, businessId);
    if (!path) return res.status(403).json({ error: "Not authorised" });

    const { start, end } = getDateRange(range, startDate, endDate);

    const snap = await db.collection(`users/${path.ownerId}/businesses/${path.businessId}/investments`)
      .where("date", ">=", start)
      .where("date", "<=", end)
      .orderBy("date", "desc")
      .get();

    const investments = [];
    let totalAmount = 0;

    snap.forEach(doc => {
      const d = doc.data();
      const amount = d.amount || 0;
      totalAmount += amount;
      investments.push({
        id: doc.id,
        ...d,
        date: d.date ? d.date.toDate().toISOString() : null,
        createdAt: d.createdAt ? d.createdAt.toDate().toISOString() : null
      });
    });

    res.status(200).json({
      summary: { totalAmount, count: investments.length },
      range: { type: range, start: start.toISOString(), end: end.toISOString() },
      investments
    });
  } catch (err) {
    if (err.message.includes("expired") || err.message.includes("disabled")) {
      return res.status(403).json({ error: "Access Denied", message: err.message });
    }
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

/**
 * DELETE /api/investment/:id?businessId=…
 */
app.delete("/api/investment/:id", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { businessId } = req.query;
    const userId = req.user.userId;
    const userMobile = req.user.phoneNumber || req.user.phone || req.user.phone_number;
    if (!businessId) return res.status(400).json({ error: "businessId is required" });

    const path = await resolveBusinessPath(userId, userMobile, businessId);
    if (!path) return res.status(403).json({ error: "Not authorised" });

    await db.doc(`users/${path.ownerId}/businesses/${path.businessId}/investments/${id}`).delete();
    res.status(200).json({ message: "Investment deleted" });
  } catch (err) {
    if (err.message.includes("expired") || err.message.includes("disabled")) {
      return res.status(403).json({ error: "Access Denied", message: err.message });
    }
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});


// ─────────────────────────────────────────────────────────────────────────────
//  DASHBOARD
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/dashboard?businessId=…&range=…&startDate=&endDate=
 *
 * Returns a comprehensive payload:
 * {
 *   summary: { revenue, expenses, profit, profitPercent, loss, lossPercent, isProfit, totalBills, avgOrderValue },
 *   charts: {
 *     daily:   [{ date, revenue, expenses }],  // every day in range
 *     weekly:  [{ week, revenue, expenses }],  // ISO week numbers
 *     monthly: [{ month, revenue, expenses }]  // Jan-Dec labels
 *   },
 *   topItems: [{ name, qty, revenue }],
 *   range: { type, start, end }
 * }
 */
app.get("/api/dashboard", authMiddleware, async (req, res) => {
  try {
    const { businessId, range = "today", startDate, endDate } = req.query;
    const userId = req.user.userId;
    const userMobile = req.user.phoneNumber || req.user.phone || req.user.phone_number;

    if (!businessId) return res.status(400).json({ error: "businessId is required" });

    const path = await resolveBusinessPath(userId, userMobile, businessId);
    if (!path) return res.status(403).json({ error: "Not authorised" });

    let dateRange;
    try {
      dateRange = getDateRange(range, startDate, endDate);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }

    const { start, end } = dateRange;

    // Fetch bills and investments in parallel
    const billsRef = db.collection(`users/${path.ownerId}/businesses/${path.businessId}/bills`);
    const invRef   = db.collection(`users/${path.ownerId}/businesses/${path.businessId}/investments`);

    const [billsSnap, invSnap, itemsSnap] = await Promise.all([
      billsRef.where("createdAt", ">=", start).where("createdAt", "<=", end).get(),
      invRef.where("date", ">=", start).where("date", "<=", end).get(),
      db.collection(`users/${path.ownerId}/businesses/${path.businessId}/items`).get()
    ]);

    const itemsMap = {};
    itemsSnap.forEach(doc => { itemsMap[doc.id] = doc.data().name || "Unknown Item"; });

    // ── Aggregate Bills ──────────────────────────────────────────
    let totalRevenue = 0;
    let totalBills = 0;
    const paymentModes = { Cash: 0, UPI: 0, Card: 0 };
    const itemSales = {};          // { itemName: { qty, revenue } }
    const dailyRevMap = {};        // { "2024-04-20": number }
    const weeklyRevMap = {};       // { "2024-W16": number }
    const monthlyRevMap = {};      // { "2024-04": number }

    billsSnap.forEach(doc => {
      const d = doc.data();
      const billDate = d.createdAt ? d.createdAt.toDate() : new Date();
      const amt = d.total || 0;

      totalRevenue += amt;
      totalBills++;

      const pMode = d.paymentMode || "Cash";
      if (paymentModes[pMode] !== undefined) {
        paymentModes[pMode] += amt;
      } else {
        paymentModes[pMode] = (paymentModes[pMode] || 0) + amt;
      }

      const dayKey     = format(billDate, "yyyy-MM-dd");
      const weekKey    = format(billDate, "yyyy-'W'II");
      const monthKey   = format(billDate, "yyyy-MM");

      dailyRevMap[dayKey]   = (dailyRevMap[dayKey]   || 0) + amt;
      weeklyRevMap[weekKey] = (weeklyRevMap[weekKey] || 0) + amt;
      monthlyRevMap[monthKey] = (monthlyRevMap[monthKey] || 0) + amt;

      // Top items
      if (Array.isArray(d.items)) {
        d.items.forEach(item => {
          let key = item.name;
          if (!key) key = itemsMap[item.itemId] || "Unknown Item";

          if (!itemSales[key]) itemSales[key] = { qty: 0, revenue: 0 };
          itemSales[key].qty     += item.quantity || 1;
          itemSales[key].revenue += (item.price || 0) * (item.quantity || 1);
        });
      }
    });

    // ── Aggregate Investments ────────────────────────────────────
    let totalExpenses = 0;
    const dailyExpMap   = {};
    const weeklyExpMap  = {};
    const monthlyExpMap = {};

    invSnap.forEach(doc => {
      const d = doc.data();
      const invDate = d.date ? d.date.toDate() : new Date();
      const amt = d.amount || 0;

      totalExpenses += amt;

      const dayKey   = format(invDate, "yyyy-MM-dd");
      const weekKey  = format(invDate, "yyyy-'W'II");
      const monthKey = format(invDate, "yyyy-MM");

      dailyExpMap[dayKey]     = (dailyExpMap[dayKey]     || 0) + amt;
      weeklyExpMap[weekKey]   = (weeklyExpMap[weekKey]   || 0) + amt;
      monthlyExpMap[monthKey] = (monthlyExpMap[monthKey] || 0) + amt;
    });

    // ── Profit / Loss ────────────────────────────────────────────
    const net = totalRevenue - totalExpenses;
    const isProfit = net >= 0;
    const profitLossPct = totalRevenue > 0
      ? Math.abs((net / totalRevenue) * 100)
      : 0;

    // ── Build Chart Arrays ───────────────────────────────────────
    const allDayKeys   = [...new Set([...Object.keys(dailyRevMap),   ...Object.keys(dailyExpMap)])].sort();
    const allWeekKeys  = [...new Set([...Object.keys(weeklyRevMap),  ...Object.keys(weeklyExpMap)])].sort();
    const allMonthKeys = [...new Set([...Object.keys(monthlyRevMap), ...Object.keys(monthlyExpMap)])].sort();

    const dailyChart   = allDayKeys.map(k  => ({ date:  k, revenue: dailyRevMap[k]   || 0, expenses: dailyExpMap[k]   || 0 }));
    const weeklyChart  = allWeekKeys.map(k => ({ week:  k, revenue: weeklyRevMap[k]  || 0, expenses: weeklyExpMap[k]  || 0 }));
    const monthlyChart = allMonthKeys.map(k => ({ month: k, revenue: monthlyRevMap[k] || 0, expenses: monthlyExpMap[k] || 0 }));

    // ── Top 10 Items ─────────────────────────────────────────────
    const topItems = Object.entries(itemSales)
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    res.status(200).json({
      summary: {
        revenue:      totalRevenue,
        expenses:     totalExpenses,
        net,
        isProfit,
        profitLossPct: parseFloat(profitLossPct.toFixed(2)),
        totalBills,
        avgOrderValue: totalBills > 0 ? parseFloat((totalRevenue / totalBills).toFixed(2)) : 0,
        paymentModes
      },
      charts: {
        daily:   dailyChart,
        weekly:  weeklyChart,
        monthly: monthlyChart
      },
      topItems,
      range: {
        type:  range,
        start: start.toISOString(),
        end:   end.toISOString()
      }
    });

  } catch (err) {
    if (err.message.includes("expired") || err.message.includes("disabled")) {
      return res.status(403).json({ error: "Access Denied", message: err.message });
    }
    console.error("Error fetching dashboard:", err);
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});


// ─────────────────────────────────────────────────────────────────────────────
//  REPORTS  (detailed bill list + aggregation)
// ─────────────────────────────────────────────────────────────────────────────

app.get("/api/reports", authMiddleware, async (req, res) => {
  try {
    const { businessId, range = "today", startDate, endDate } = req.query;
    const userId = req.user.userId;
    const userMobile = req.user.phoneNumber || req.user.phone || req.user.phone_number;
    if (!businessId) return res.status(400).json({ error: "businessId is required" });

    const path = await resolveBusinessPath(userId, userMobile, businessId);
    if (!path) return res.status(403).json({ error: "Not authorised" });

    let dr;
    try { dr = getDateRange(range, startDate, endDate); }
    catch (e) { return res.status(400).json({ error: e.message }); }

    const { start, end } = dr;

    const snap = await db.collection(`users/${path.ownerId}/businesses/${path.businessId}/bills`)
      .where("createdAt", ">=", start)
      .where("createdAt", "<=", end)
      .orderBy("createdAt", "desc")
      .get();

    const itemsSnap = await db.collection(`users/${path.ownerId}/businesses/${path.businessId}/items`).get();
    const itemsMap = {};
    itemsSnap.forEach(doc => { itemsMap[doc.id] = doc.data().name || "Unknown Item"; });

    let totalRevenue = 0;
    let totalBills = 0;
    const salesByCategory = {};
    const itemSales = {}; // New: Track individual item sales
    const bills = [];

    snap.forEach(doc => {
      const d = doc.data();
      totalRevenue += d.total || 0;
      totalBills++;

      if (Array.isArray(d.items)) {
        d.items.forEach(item => {
          const qty = item.quantity || 1;
          const itemRevenue = (item.price || 0) * qty;

          // Category aggregation
          const cat = item.categoryId || "Uncategorized";
          salesByCategory[cat] = (salesByCategory[cat] || 0) + itemRevenue;

          // Item aggregation
          let itemName = item.name;
          if (!itemName) itemName = itemsMap[item.itemId] || "Unknown Item";

          if (!itemSales[itemName]) {
            itemSales[itemName] = { qty: 0, revenue: 0 };
          }
          itemSales[itemName].qty += qty;
          itemSales[itemName].revenue += itemRevenue;
        });
      }

      bills.push({
        id: doc.id,
        ...d,
        createdAt: d.createdAt ? d.createdAt.toDate().toISOString() : null
      });
    });

    // Convert itemSales object to sorted array
    const sortedItemSales = Object.entries(itemSales)
      .map(([name, stats]) => ({ name, ...stats }))
      .sort((a, b) => b.revenue - a.revenue); // Sort by highest revenue

    res.status(200).json({
      summary: {
        totalRevenue,
        totalBills,
        averageOrderValue: totalBills > 0 ? parseFloat((totalRevenue / totalBills).toFixed(2)) : 0,
        salesByCategory,
        itemSales: sortedItemSales // Added to response
      },
      range: { start: start.toISOString(), end: end.toISOString(), type: range },
      bills: bills.slice(0, 200)
    });
  } catch (err) {
    if (err.message.includes("expired") || err.message.includes("disabled")) {
      return res.status(403).json({ error: "Access Denied", message: err.message });
    }
    console.error("Error fetching reports:", err);
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});


// ─────────────────────────────────────────────────────────────────────────────
//  HEALTH
// ─────────────────────────────────────────────────────────────────────────────

app.get("/health", (_, res) => res.send("OK"));

export default app;

if (process.env.NODE_ENV !== "production") {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
  });
}
