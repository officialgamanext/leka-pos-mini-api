# Leka POS Mini API (Secure Layer)

This is a Node.js backend acting as a secure API layer for the Leka POS Mini application. It uses Descope for authentication and Firebase Firestore for data storage.

## 🚀 Getting Started

### 1. Prerequisites
- Node.js installed.
- A Descope Project (Project ID and Management Key).
- A Firebase Project with Firestore enabled.
- A Firebase Service Account Key JSON file.

### 2. Environment Setup
Create a `.env` file in the root directory (copy from `.env.template` if provided):
```env
DESCOPE_PROJECT_ID=YOUR_PROJECT_ID
DESCOPE_MANAGEMENT_KEY=YOUR_MANAGEMENT_KEY
PORT=5000
# Set this for local development if not using application default credentials
# GOOGLE_APPLICATION_CREDENTIALS=path/to/service-account.json
```

### 3. Firebase Setup
The API uses `firebase-admin`. To authenticate:
- **Locally**: Set the `GOOGLE_APPLICATION_CREDENTIALS` environment variable to the path of your downloaded service account JSON file.
- **Production**: If deployed on Google Cloud (Cloud Run, Functions), it uses the service account attached to the resource automatically.

### 4. Installation
```bash
npm install
```

### 5. Running the API
```bash
npm start
```

## 🔐 Security Architecture
1. **Frontend Auth**: Frontend authenticates with Descope and receives a JWT.
2. **Backend Validation**: Every API call must include `Authorization: Bearer <JWT>`. The backend validates this token using `@descope/node-sdk`.
3. **Firestore Access**: The Firestore database is locked down with security rules. Only this backend (using the Admin SDK) can read/write data.
4. **Data Isolation**: Data is stored under `users/{userId}/...` where `userId` is the Descope User ID, ensuring users only see their own data.

## 📂 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/business` | Create a new business |
| POST | `/api/category` | Create a category for a business |
| POST | `/api/item` | Create an item for a business |
| POST | `/api/bill` | Create a bill/transaction |
| GET | `/api/reports/daily` | Get revenue summary |

## 🛡️ Firestore Rules
Apply the following rules in your Firebase Console to secure the database:
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```
"# leka-pos-mini-api" 
