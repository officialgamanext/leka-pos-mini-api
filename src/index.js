import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { db, FieldValue } from "./config/firebase.js";
import { authMiddleware } from "./middleware/auth.js";
import { getDateRange } from "./helpers/dateRange.js";
import { format } from "date-fns";
import ImageKit from "imagekit";

const imagekit = new ImageKit({
  publicKey: process.env.IMAGEKIT_PUBLIC_KEY || "your_public_key",
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY || "your_private_key",
  urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT || "https://ik.imagekit.io/your_imagekit_id"
});

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());


// ─────────────────────────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Resolve the Firestore path for a business.
 *  Owners:  users/{ownerId}/businesses/{businessId}
 *  Staff :  same path but the ownerId is stored in the business doc
 */
async function resolveBusinessPath(userId, businessId) {
  // Check if user owns it
  const ownerRef = db.doc(`users/${userId}/businesses/${businessId}`);
  const ownerSnap = await ownerRef.get();
  if (ownerSnap.exists) return { ownerId: userId, businessId };

  // Check if user is a staff member on any business
  const staffSnap = await db.collectionGroup("staff")
    .where("userId", "==", userId)
    .where("businessId", "==", businessId)
    .limit(1)
    .get();

  if (!staffSnap.empty) {
    const staffDoc = staffSnap.docs[0];
    const ownerId = staffDoc.ref.parent.parent.parent.parent.id; // users/{ownerId}/businesses/{bId}/staff/{docId}
    return { ownerId, businessId };
  }

  return null;
}

/** Return all businesses visible to a user (own + as staff) */
async function getAccessibleBusinesses(userId) {
  const results = [];

  // 1. Own businesses
  const ownSnap = await db.collection(`users/${userId}/businesses`).get();
  ownSnap.forEach(doc => {
    results.push({ id: doc.id, ...doc.data(), role: "owner" });
  });

  // 2. Businesses where user is staff
  const staffSnap = await db.collectionGroup("staff")
    .where("userId", "==", userId)
    .get();

  const staffBizPromises = staffSnap.docs.map(async (staffDoc) => {
    // Path: users/{ownerId}/businesses/{bId}/staff/{staffId}
    const bizRef = staffDoc.ref.parent.parent;
    const bizSnap = await bizRef.get();
    if (bizSnap.exists) {
      return { id: bizSnap.id, ...bizSnap.data(), role: staffDoc.data().role || "staff" };
    }
    return null;
  });

  const staffBizResults = (await Promise.all(staffBizPromises)).filter(Boolean);
  results.push(...staffBizResults);

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
    const businessRef = db.collection(`users/${userId}/businesses`);
    const newBusiness = await businessRef.add({
      name,
      ownerId: userId,
      createdAt: FieldValue.serverTimestamp()
    });

    res.status(201).json({ id: newBusiness.id, name, role: "owner", message: "Business created successfully" });
  } catch (err) {
    console.error("Error creating business:", err);
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

/**
 * GET /api/businesses  — List all businesses (owned + staff)
 * Response includes { role: "owner" | "staff" | "manager" } per business
 */
app.get("/api/businesses", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const businesses = await getAccessibleBusinesses(userId);
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
 * POST /api/staff  — Add a staff member to a business
 * Body: { businessId, staffUserId, role }
 * Only the owner can add staff.
 */
app.post("/api/staff", authMiddleware, async (req, res) => {
  try {
    const { businessId, staffUserId, role = "staff" } = req.body;
    const userId = req.user.userId; // must be the owner

    if (!businessId || !staffUserId) {
      return res.status(400).json({ error: "businessId and staffUserId are required" });
    }

    // Verify ownership
    const bizRef = db.doc(`users/${userId}/businesses/${businessId}`);
    const bizSnap = await bizRef.get();
    if (!bizSnap.exists) {
      return res.status(403).json({ error: "Not authorised: you do not own this business" });
    }

    const validRoles = ["staff", "manager"];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: `Invalid role. Must be one of: ${validRoles.join(", ")}` });
    }

    const staffRef = db.collection(`users/${userId}/businesses/${businessId}/staff`);

    // Prevent duplicate
    const existing = await staffRef.where("userId", "==", staffUserId).limit(1).get();
    if (!existing.empty) {
      return res.status(409).json({ error: "This user is already a staff member" });
    }

    const newStaff = await staffRef.add({
      userId: staffUserId,
      businessId,
      role,
      addedAt: FieldValue.serverTimestamp()
    });

    res.status(201).json({ id: newStaff.id, message: "Staff member added successfully" });
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
    if (!businessId || !name) return res.status(400).json({ error: "businessId and name are required" });

    const ref = db.collection(`users/${userId}/businesses/${businessId}/categories`);
    const doc = await ref.add({ name, createdAt: FieldValue.serverTimestamp() });
    res.status(201).json({ id: doc.id, message: "Category created" });
  } catch (err) {
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

app.get("/api/categories", authMiddleware, async (req, res) => {
  try {
    const { businessId } = req.query;
    const userId = req.user.userId;
    if (!businessId) return res.status(400).json({ error: "businessId is required" });

    const snap = await db.collection(`users/${userId}/businesses/${businessId}/categories`).get();
    const data = [];
    snap.forEach(doc => data.push({ id: doc.id, ...doc.data() }));
    res.status(200).json(data);
  } catch (err) {
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
    if (!businessId || !name || price === undefined) {
      return res.status(400).json({ error: "businessId, name, and price are required" });
    }

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
        // Depending on your requirements, you might want to return an error here
        // return res.status(500).json({ error: "Failed to upload image" });
      }
    }

    const ref = db.collection(`users/${userId}/businesses/${businessId}/items`);
    const doc = await ref.add({
      name,
      price: parseFloat(price),
      categoryId: categoryId || null,
      imageUrl: finalImageUrl,
      createdAt: FieldValue.serverTimestamp()
    });
    res.status(201).json({ id: doc.id, message: "Item created", imageUrl: finalImageUrl });
  } catch (err) {
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

app.get("/api/items", authMiddleware, async (req, res) => {
  try {
    const { businessId } = req.query;
    const userId = req.user.userId;
    if (!businessId) return res.status(400).json({ error: "businessId is required" });

    const snap = await db.collection(`users/${userId}/businesses/${businessId}/items`).get();
    const data = [];
    snap.forEach(doc => data.push({ id: doc.id, ...doc.data() }));
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});


// ─────────────────────────────────────────────────────────────────────────────
//  BILLS
// ─────────────────────────────────────────────────────────────────────────────

app.post("/api/bill", authMiddleware, async (req, res) => {
  try {
    const { businessId, items, total, discount = 0, tax = 0, paymentMethod = "cash" } = req.body;
    const userId = req.user.userId;
    if (!businessId || !items || total === undefined) {
      return res.status(400).json({ error: "businessId, items, and total are required" });
    }

    const ref = db.collection(`users/${userId}/businesses/${businessId}/bills`);
    const doc = await ref.add({
      items,
      total: parseFloat(total),
      discount: parseFloat(discount),
      tax: parseFloat(tax),
      paymentMethod,
      createdAt: FieldValue.serverTimestamp()
    });
    res.status(201).json({ id: doc.id, message: "Bill created" });
  } catch (err) {
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

app.get("/api/bills", authMiddleware, async (req, res) => {
  try {
    const { businessId, range = "today", startDate, endDate, limit: limitParam } = req.query;
    const userId = req.user.userId;
    if (!businessId) return res.status(400).json({ error: "businessId is required" });

    const { start, end } = getDateRange(range, startDate, endDate);
    const pageLimit = Math.min(parseInt(limitParam) || 50, 200);

    const snap = await db.collection(`users/${userId}/businesses/${businessId}/bills`)
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

    if (!businessId || !title || amount === undefined) {
      return res.status(400).json({ error: "businessId, title, and amount are required" });
    }

    const investmentDate = date ? new Date(date) : new Date();

    const ref = db.collection(`users/${userId}/businesses/${businessId}/investments`);
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
    if (!businessId) return res.status(400).json({ error: "businessId is required" });

    const { start, end } = getDateRange(range, startDate, endDate);

    const snap = await db.collection(`users/${userId}/businesses/${businessId}/investments`)
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
    if (!businessId) return res.status(400).json({ error: "businessId is required" });

    await db.doc(`users/${userId}/businesses/${businessId}/investments/${id}`).delete();
    res.status(200).json({ message: "Investment deleted" });
  } catch (err) {
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

    if (!businessId) return res.status(400).json({ error: "businessId is required" });

    let dateRange;
    try {
      dateRange = getDateRange(range, startDate, endDate);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }

    const { start, end } = dateRange;

    // Fetch bills and investments in parallel
    const billsRef = db.collection(`users/${userId}/businesses/${businessId}/bills`);
    const invRef   = db.collection(`users/${userId}/businesses/${businessId}/investments`);

    const [billsSnap, invSnap] = await Promise.all([
      billsRef.where("createdAt", ">=", start).where("createdAt", "<=", end).get(),
      invRef.where("date", ">=", start).where("date", "<=", end).get()
    ]);

    // ── Aggregate Bills ──────────────────────────────────────────
    let totalRevenue = 0;
    let totalBills = 0;
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
        avgOrderValue: totalBills > 0 ? parseFloat((totalRevenue / totalBills).toFixed(2)) : 0
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
    if (!businessId) return res.status(400).json({ error: "businessId is required" });

    let dr;
    try { dr = getDateRange(range, startDate, endDate); }
    catch (e) { return res.status(400).json({ error: e.message }); }

    const { start, end } = dr;

    const snap = await db.collection(`users/${userId}/businesses/${businessId}/bills`)
      .where("createdAt", ">=", start)
      .where("createdAt", "<=", end)
      .orderBy("createdAt", "desc")
      .get();

    const itemsSnap = await db.collection(`users/${userId}/businesses/${businessId}/items`).get();
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
    console.error("Error fetching reports:", err);
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});


// ─────────────────────────────────────────────────────────────────────────────
//  HEALTH
// ─────────────────────────────────────────────────────────────────────────────

app.get("/health", (_, res) => res.send("OK"));

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
