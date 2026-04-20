# 🚀 Leka POS Mini — API Reference

Base URL: `http://localhost:5000`

All protected endpoints require an `Authorization: Bearer <descope-jwt>` header.

---

## 📋 Common Query Parameters (Date Ranges)

Many endpoints accept a `range` parameter. Valid values:

| Value | Description |
|-------|-------------|
| `today` | current day |
| `yesterday` | previous day |
| `thisWeek` | Mon → now |
| `lastWeek` | Mon → Sun of previous week |
| `thisMonth` | 1st of month → now |
| `lastMonth` | full previous month |
| `thisYear` | Jan 1 → now |
| `lastYear` | full previous year |
| `custom` | requires `startDate` (YYYY-MM-DD) + `endDate` (YYYY-MM-DD) |

---

## 🏢 Business

### `POST /api/business`
Create a new business (caller becomes owner).

**Body:**
```json
{ "name": "My Restaurant" }
```

**Response:**
```json
{ "id": "abc123", "name": "My Restaurant", "role": "owner" }
```

---

### `GET /api/businesses`
List all businesses accessible to the authenticated user (owned + staff).

**Response:**
```json
[
  { "id": "abc123", "name": "My Restaurant", "role": "owner", ... },
  { "id": "xyz789", "name": "Partner Café",  "role": "staff",  ... }
]
```

> On login: check `role` per business. Owners see all settings; staff see billing/products only.

---

## 👥 Staff

### `POST /api/staff`
Add a staff member (owner only).

**Body:**
```json
{ "businessId": "abc123", "staffUserId": "descope-user-id", "role": "staff" }
```
`role` can be `"staff"` or `"manager"`.

---

### `GET /api/staff?businessId=abc123`
List staff for a business.

---

### `DELETE /api/staff/:staffId?businessId=abc123`
Remove a staff member.

---

## 📂 Categories

### `POST /api/category`
```json
{ "businessId": "abc123", "name": "Beverages" }
```

### `GET /api/categories?businessId=abc123`
Returns array of category objects.

---

## 🍔 Items

### `POST /api/item`
```json
{ "businessId": "abc123", "name": "Masala Chai", "price": 25, "categoryId": "cat1" }
```

### `GET /api/items?businessId=abc123`
Returns all items (no filter).

---

## 🧾 Bills

### `POST /api/bill`
```json
{
  "businessId": "abc123",
  "items": [{ "name": "Chai", "price": 25, "quantity": 2, "categoryId": "cat1" }],
  "total": 50,
  "discount": 0,
  "tax": 0,
  "paymentMethod": "cash"
}
```

### `GET /api/bills?businessId=abc123&range=today`
Returns paginated bill list for the date range.

---

## 💰 Investments / Expenses

### `POST /api/investment`
Record an investment or expense.

**Body:**
```json
{
  "businessId": "abc123",
  "title": "Rice purchase",
  "amount": 2500,
  "category": "Inventory",
  "note": "Optional note",
  "date": "2024-04-20"   /* optional, defaults to now */
}
```

### `GET /api/investments?businessId=abc123&range=thisMonth`
**Response:**
```json
{
  "summary": { "totalAmount": 12500, "count": 5 },
  "range": { "type": "thisMonth", "start": "...", "end": "..." },
  "investments": [
    { "id": "...", "title": "Rice purchase", "amount": 2500, "category": "Inventory", "date": "2024-04-20T..." }
  ]
}
```

### `DELETE /api/investment/:id?businessId=abc123`

---

## 📊 Dashboard

### `GET /api/dashboard?businessId=abc123&range=today`

**Full Response:**
```json
{
  "summary": {
    "revenue": 12500,
    "expenses": 4000,
    "net": 8500,
    "isProfit": true,
    "profitLossPct": 68.0,
    "totalBills": 47,
    "avgOrderValue": 265.96
  },
  "charts": {
    "daily":   [{ "date": "2024-04-20", "revenue": 1200, "expenses": 300 }],
    "weekly":  [{ "week": "2024-W16",   "revenue": 4500, "expenses": 900 }],
    "monthly": [{ "month": "2024-04",   "revenue": 12500, "expenses": 4000 }]
  },
  "topItems": [
    { "name": "Masala Chai", "qty": 120, "revenue": 3000 }
  ],
  "range": { "type": "today", "start": "...", "end": "..." }
}
```

> **Frontend usage:**
> - `isProfit: true`  → show green profit badge
> - `isProfit: false` → show red loss badge
> - `profitLossPct`   → percentage amount for the badge
> - `net`             → exact ₹ amount
> - `charts.daily`    → line/bar chart for day view
> - `charts.weekly`   → bar chart for week view
> - `charts.monthly`  → bar chart for year/month view

---

## 📈 Reports (Detailed)

### `GET /api/reports?businessId=abc123&range=thisMonth`

Similar to Dashboard but returns the full bill list for display in a table/list UI.

---

## ❤️ Health

### `GET /health`
Returns `OK` — use to confirm server is running.
