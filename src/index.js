import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { db, FieldValue } from "./config/firebase.js";
import { authMiddleware } from "./middleware/auth.js";
import { 
  startOfDay, endOfDay, subDays, 
  startOfWeek, endOfWeek, subWeeks, 
  startOfMonth, endOfMonth, subMonths, 
  startOfYear, endOfYear, subYears,
  parseISO 
} from "date-fns";


dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// --- SECURE API ENDPOINTS ---

/**
 * 🏢 Create Business
 * POST /api/business
 * Protected by authMiddleware
 */
app.post("/api/business", authMiddleware, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: "Business name is required" });

    const userId = req.user.userId;

    const businessRef = db.collection(`users/${userId}/businesses`);
    const newBusiness = await businessRef.add({
      name,
      createdAt: FieldValue.serverTimestamp(),
      ownerId: userId // Adding owner info for future multi-user support
    });

    res.status(201).json({ id: newBusiness.id, message: "Business created successfully" });
  } catch (error) {
    console.error("Error creating business:", error);
    res.status(500).json({ error: "Internal server error", message: error.message });
  }
});

/**
 * 🏢 List User's Businesses
 * GET /api/businesses
 */
app.get("/api/businesses", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const businessesRef = db.collection(`users/${userId}/businesses`);
    const snapshot = await businessesRef.get();

    const businesses = [];
    snapshot.forEach(doc => {
      businesses.push({ id: doc.id, ...doc.data() });
    });

    res.status(200).json(businesses);
  } catch (error) {
    console.error("Error fetching businesses:", error);
    res.status(500).json({ error: "Internal server error", message: error.message });
  }
});

/**
 * 📂 Create Category
 * POST /api/category
 */
app.post("/api/category", authMiddleware, async (req, res) => {
  try {
    const { businessId, name } = req.body;
    const userId = req.user.userId;

    if (!businessId || !name) {
      return res.status(400).json({ error: "businessId and name are required" });
    }

    const categoriesRef = db.collection(`users/${userId}/businesses/${businessId}/categories`);
    const newCategory = await categoriesRef.add({
      name,
      createdAt: FieldValue.serverTimestamp()
    });

    res.status(201).json({ id: newCategory.id, message: "Category created" });
  } catch (error) {
    console.error("Error creating category:", error);
    res.status(500).json({ error: "Internal server error", message: error.message });
  }
});

/**
 * 📂 List Categories
 * GET /api/categories
 */
app.get("/api/categories", authMiddleware, async (req, res) => {
  try {
    const { businessId } = req.query;
    const userId = req.user.userId;
    console.log(`[GET /api/categories] Business ID: ${businessId}, User ID: ${userId}`);

    if (!businessId) {
      return res.status(400).json({ error: "businessId query parameter is required" });
    }

    const categoriesRef = db.collection(`users/${userId}/businesses/${businessId}/categories`);
    const snapshot = await categoriesRef.get();

    const categories = [];
    snapshot.forEach(doc => {
      categories.push({ id: doc.id, ...doc.data() });
    });

    res.status(200).json(categories);
  } catch (error) {
    console.error("Error fetching categories:", error);
    res.status(500).json({ error: "Internal server error", message: error.message });
  }
});

/**
 * 🍔 Create Item
 * POST /api/item
 */
app.post("/api/item", authMiddleware, async (req, res) => {
  try {
    const { businessId, name, price, categoryId } = req.body;
    const userId = req.user.userId;

    if (!businessId || !name || price === undefined) {
      return res.status(400).json({ error: "businessId, name, and price are required" });
    }

    const itemsRef = db.collection(`users/${userId}/businesses/${businessId}/items`);
    const newItem = await itemsRef.add({
      name,
      price: parseFloat(price),
      categoryId: categoryId || null,
      createdAt: FieldValue.serverTimestamp()
    });

    res.status(201).json({ id: newItem.id, message: "Item created" });
  } catch (error) {
    console.error("Error creating item:", error);
    res.status(500).json({ error: "Internal server error", message: error.message });
  }
});

/**
 * 🍔 List Items
 * GET /api/items
 */
app.get("/api/items", authMiddleware, async (req, res) => {
  try {
    const { businessId } = req.query;
    const userId = req.user.userId;
    console.log(`[GET /api/items] Business ID: ${businessId}, User ID: ${userId}`);

    if (!businessId) {
      return res.status(400).json({ error: "businessId query parameter is required" });
    }

    const itemsRef = db.collection(`users/${userId}/businesses/${businessId}/items`);
    const snapshot = await itemsRef.get();

    const items = [];
    snapshot.forEach(doc => {
      items.push({ id: doc.id, ...doc.data() });
    });

    res.status(200).json(items);
  } catch (error) {
    console.error("Error fetching items:", error);
    res.status(500).json({ error: "Internal server error", message: error.message });
  }
});

/**
 * 🧾 Create Bill
 * POST /api/bill
 */
app.post("/api/bill", authMiddleware, async (req, res) => {
  try {
    const { businessId, items, total } = req.body;
    const userId = req.user.userId;

    if (!businessId || !items || total === undefined) {
      return res.status(400).json({ error: "businessId, items, and total are required" });
    }

    const billsRef = db.collection(`users/${userId}/businesses/${businessId}/bills`);
    const newBill = await billsRef.add({
      items,
      total: parseFloat(total),
      createdAt: FieldValue.serverTimestamp()
    });

    res.status(201).json({ id: newBill.id, message: "Bill created" });
  } catch (error) {
    console.error("Error creating bill:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});


/**
 * 📊 Comprehensive Reports API
 * GET /api/reports
 * Query Params: businessId (req), range (opt), startDate (opt), endDate (opt)
 */
app.get("/api/reports", authMiddleware, async (req, res) => {
  try {
    const { businessId, range = "today", startDate, endDate } = req.query;
    const userId = req.user.userId;

    if (!businessId) {
      return res.status(400).json({ error: "businessId query parameter is required" });
    }

    let start, end;
    const now = new Date();

    // Determine the date range
    switch (range) {
      case "today":
        start = startOfDay(now);
        end = endOfDay(now);
        break;
      case "yesterday":
        const yesterday = subDays(now, 1);
        start = startOfDay(yesterday);
        end = endOfDay(yesterday);
        break;
      case "thisWeek":
        start = startOfWeek(now, { weekStartsOn: 1 }); // Monday start
        end = endOfDay(now);
        break;
      case "lastWeek":
        const lastWeek = subWeeks(now, 1);
        start = startOfWeek(lastWeek, { weekStartsOn: 1 });
        end = endOfWeek(lastWeek, { weekStartsOn: 1 });
        break;
      case "thisMonth":
        start = startOfMonth(now);
        end = endOfDay(now);
        break;
      case "lastMonth":
        const lastMonth = subMonths(now, 1);
        start = startOfMonth(lastMonth);
        end = endOfMonth(lastMonth);
        break;
      case "thisYear":
        start = startOfYear(now);
        end = endOfDay(now);
        break;
      case "lastYear":
        const lastYear = subYears(now, 1);
        start = startOfYear(lastYear);
        end = endOfYear(lastYear);
        break;
      case "custom":
        if (!startDate || !endDate) {
          return res.status(400).json({ error: "startDate and endDate are required for custom range" });
        }
        start = startOfDay(parseISO(startDate));
        end = endOfDay(parseISO(endDate));
        break;
      default:
        return res.status(400).json({ error: "Invalid range parameter" });
    }

    // Query Firestore
    const billsRef = db.collection(`users/${userId}/businesses/${businessId}/bills`);
    
    // Convert JS dates to Firestore Timestamps
    const snapshot = await billsRef
      .where('createdAt', '>=', start)
      .where('createdAt', '<=', end)
      .orderBy('createdAt', 'desc')
      .get();

    let totalRevenue = 0;
    let totalBills = 0;
    const bills = [];
    const salesByCategory = {};

    snapshot.forEach(doc => {
      const data = doc.data();
      totalRevenue += data.total || 0;
      totalBills++;
      
      // Basic aggregation for dashboard/charts
      if (data.items && Array.isArray(data.items)) {
        data.items.forEach(item => {
          const catId = item.categoryId || "Uncategorized";
          salesByCategory[catId] = (salesByCategory[catId] || 0) + (item.price * (item.quantity || 1));
        });
      }

      bills.push({ 
        id: doc.id, 
        ...data,
        createdAt: data.createdAt ? data.createdAt.toDate().toISOString() : null
      });
    });

    res.status(200).json({ 
      summary: {
        totalRevenue,
        totalBills,
        averageOrderValue: totalBills > 0 ? (totalRevenue / totalBills) : 0,
        salesByCategory
      },
      range: { start, end, type: range },
      bills: bills.slice(0, 100) // Return last 100 bills for the list view
    });

  } catch (error) {
    console.error("Error fetching comprehensive report:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Health check
app.get("/health", (req, res) => res.send("API is running"));

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
