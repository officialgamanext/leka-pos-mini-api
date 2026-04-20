# Leka POS Mini - Client-Side API Guide

This guide explains how to integrate your frontend (React/Vite) with the secure Node.js API layer.

---

## 🔐 1. Authentication (Descope)

Every request to the API **MUST** include a valid Descope JWT in the `Authorization` header.

### Get Token from Descope SDK
```javascript
import { useSession } from '@descope/react-sdk';

const { sessionToken } = useSession();

// use this token in your API calls
```

### The Authorization Header
```javascript
const headers = {
  'Authorization': `Bearer ${sessionToken}`,
  'Content-Type': 'application/json'
};
```

---

## 🏢 2. Businesses

### Create a Business
```javascript
const createBusiness = async (name) => {
  const response = await fetch('http://localhost:5000/api/business', {
    method: 'POST',
    headers,
    body: JSON.stringify({ name })
  });
  return await response.json();
};
```

### List My Businesses
```javascript
const getMyBusinesses = async () => {
  const response = await fetch('http://localhost:5000/api/businesses', {
    headers
  });
  return await response.json();
};
```

---

## 📂 3. Categories & Items

### Create a Category
```javascript
const createCategory = async (businessId, name) => {
  await fetch('http://localhost:5000/api/category', {
    method: 'POST',
    headers,
    body: JSON.stringify({ businessId, name })
  });
};
```

### Create an Item
```javascript
const createItem = async (businessId, name, price, categoryId) => {
  await fetch('http://localhost:5000/api/item', {
    method: 'POST',
    headers,
    body: JSON.stringify({ businessId, name, price, categoryId })
  });
};
```

---

## 🧾 4. Bills (Transactions)

### Create a Bill
```javascript
const createBill = async (businessId, cartItems, total) => {
  await fetch('http://localhost:5000/api/bill', {
    method: 'POST',
    headers,
    body: JSON.stringify({ 
      businessId, 
      items: cartItems, // Array of { name, price, quantity, categoryId }
      total 
    })
  });
};
```

---

## 📊 5. Reports & Dashboard

The reports API is powerful. Use the `range` parameter to get different summaries.

### Get Dashboard Summary (Today)
```javascript
const getTodaySummary = async (businessId) => {
  const response = await fetch(`http://localhost:5000/api/reports?businessId=${businessId}&range=today`, {
    headers
  });
  const data = await response.json();
  console.log(data.summary.totalRevenue);
  console.log(data.summary.salesByCategory); // Use for Pie Charts
};
```

### Get Last Week's Report
```javascript
const getLastWeekReport = async (businessId) => {
  const response = await fetch(`http://localhost:5000/api/reports?businessId=${businessId}&range=lastWeek`, {
    headers
  });
  return await response.json();
};
```

### Custom Date Range
```javascript
const getCustomReport = async (businessId, start, end) => {
  // Format: YYYY-MM-DD
  const url = `http://localhost:5000/api/reports?businessId=${businessId}&range=custom&startDate=${start}&endDate=${end}`;
  const response = await fetch(url, { headers });
  return await response.json();
};
```

---

## 💡 Best Practices
1. **Handling 401 Errors**: If the API returns `401 Unauthorized`, it means the Descope session has expired. Redirect the user to the login page.
2. **Business ID**: Store the `businessId` in your app state or local storage after the user selects which business they are currently managing.
3. **Loading States**: Since the API calculates reports on the fly, show a loading spinner when calling `/api/reports`.
