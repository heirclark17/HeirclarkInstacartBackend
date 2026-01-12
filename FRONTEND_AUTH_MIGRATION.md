# Frontend Authentication Migration Guide

## Issue
After applying strict JWT authentication (`strictAuth: true`) to all backend routes, the frontend calorie-counter page is receiving 401 Unauthorized errors because it's still using the legacy authentication method (shopifyCustomerId parameter).

## Solution
The backend now provides a JWT token generation endpoint. The frontend needs to:
1. Get a JWT token from the new `/api/v1/auth/token` endpoint
2. Store the token securely
3. Include the token in all subsequent API requests

---

## Step 1: Get JWT Token

### Endpoint
```
POST https://heirclarkinstacartbackend-production.up.railway.app/api/v1/auth/token
```

### Request
```javascript
const response = await fetch('https://heirclarkinstacartbackend-production.up.railway.app/api/v1/auth/token', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    shopifyCustomerId: '9339338686771' // Your Shopify customer ID
  })
});

const data = await response.json();
```

### Response (200 OK)
```json
{
  "ok": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJjdXN0b21lcklkIjoiOTMzOTMzODY4Njc3MSIsImlhdCI6MTczNjY0MDAwMCwiZXhwIjoxNzM3MjQ0ODAwfQ.signature",
  "expiresIn": "7d",
  "tokenType": "Bearer",
  "customerId": "9339338686771",
  "message": "Token generated successfully. Use this token in Authorization header: Bearer <token>"
}
```

### Error Response (400 Bad Request)
```json
{
  "ok": false,
  "error": "shopifyCustomerId is required"
}
```

---

## Step 2: Store Token Securely

### Option A: localStorage (Simple, but less secure)
```javascript
localStorage.setItem('hc_auth_token', data.token);
localStorage.setItem('hc_token_expires', Date.now() + (7 * 24 * 60 * 60 * 1000)); // 7 days
```

### Option B: sessionStorage (More secure, expires on tab close)
```javascript
sessionStorage.setItem('hc_auth_token', data.token);
```

### Option C: Memory (Most secure, but requires re-authentication on page reload)
```javascript
let authToken = data.token;
```

---

## Step 3: Use Token in API Requests

### Before (Legacy - Now Blocked ❌)
```javascript
// OLD METHOD - THIS NO LONGER WORKS
fetch('https://heirclarkinstacartbackend-production.up.railway.app/api/v1/user/goals?shopifyCustomerId=9339338686771', {
  headers: {
    'X-Shopify-Customer-Id': '9339338686771'
  }
});
// Result: 401 Unauthorized ❌
```

### After (JWT Bearer Token - Required ✅)
```javascript
// NEW METHOD - USE THIS
const token = localStorage.getItem('hc_auth_token');

fetch('https://heirclarkinstacartbackend-production.up.railway.app/api/v1/user/goals', {
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
});
// Result: 200 OK with user goals ✅
```

---

## Complete Implementation Example

### File: `hc-auth-service.js` (New file to create)

```javascript
/**
 * Heirclark Authentication Service
 * Handles JWT token generation and storage for API authentication
 */

const AUTH_API = 'https://heirclarkinstacartbackend-production.up.railway.app/api/v1';
const TOKEN_KEY = 'hc_auth_token';
const EXPIRES_KEY = 'hc_token_expires';

export class HcAuthService {
  /**
   * Get or generate JWT token for authenticated API requests
   * @param {string} shopifyCustomerId - Shopify customer ID
   * @returns {Promise<string>} JWT token
   */
  static async getToken(shopifyCustomerId) {
    // Check if we have a valid token in storage
    const existingToken = localStorage.getItem(TOKEN_KEY);
    const expiresAt = parseInt(localStorage.getItem(EXPIRES_KEY) || '0', 10);

    if (existingToken && Date.now() < expiresAt) {
      console.log('[HcAuth] Using cached token');
      return existingToken;
    }

    // Token expired or doesn't exist - generate new one
    console.log('[HcAuth] Generating new token');
    try {
      const response = await fetch(`${AUTH_API}/auth/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ shopifyCustomerId })
      });

      if (!response.ok) {
        throw new Error(`Failed to generate token: ${response.statusText}`);
      }

      const data = await response.json();

      if (!data.ok || !data.token) {
        throw new Error('Invalid token response');
      }

      // Store token and expiration (7 days from now)
      localStorage.setItem(TOKEN_KEY, data.token);
      localStorage.setItem(EXPIRES_KEY, Date.now() + (7 * 24 * 60 * 60 * 1000));

      console.log('[HcAuth] Token generated and cached successfully');
      return data.token;
    } catch (error) {
      console.error('[HcAuth] Token generation failed:', error);
      throw error;
    }
  }

  /**
   * Clear stored token (logout)
   */
  static clearToken() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(EXPIRES_KEY);
    console.log('[HcAuth] Token cleared');
  }

  /**
   * Make an authenticated API request
   * @param {string} endpoint - API endpoint (e.g., '/user/goals')
   * @param {object} options - Fetch options
   * @param {string} shopifyCustomerId - Shopify customer ID
   * @returns {Promise<any>} API response
   */
  static async fetchAuthenticated(endpoint, options = {}, shopifyCustomerId) {
    const token = await this.getToken(shopifyCustomerId);

    const headers = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };

    const response = await fetch(`${AUTH_API}${endpoint}`, {
      ...options,
      headers
    });

    // If 401, token might be invalid - clear and retry once
    if (response.status === 401) {
      console.warn('[HcAuth] 401 Unauthorized - clearing token and retrying');
      this.clearToken();

      // Retry with fresh token
      const newToken = await this.getToken(shopifyCustomerId);
      headers.Authorization = `Bearer ${newToken}`;

      return fetch(`${AUTH_API}${endpoint}`, {
        ...options,
        headers
      });
    }

    return response;
  }
}
```

---

## Update Existing Frontend Code

### File: `hc-calorie-counter-core.js`

#### Before (Lines 1543-1550)
```javascript
async function fetchAndSyncGoalsFromBackend(shopifyCustomerId) {
  try {
    const url = `${API_BASE}/user/goals?shopifyCustomerId=${shopifyCustomerId}`;
    const response = await fetchWithTimeout(url, {
      headers: {
        'X-Shopify-Customer-Id': shopifyCustomerId,
        'Content-Type': 'application/json'
      }
    });
    // ...
  }
}
```

#### After (Updated)
```javascript
import { HcAuthService } from './hc-auth-service.js';

async function fetchAndSyncGoalsFromBackend(shopifyCustomerId) {
  try {
    const response = await HcAuthService.fetchAuthenticated(
      '/user/goals',
      { method: 'GET' },
      shopifyCustomerId
    );
    // ...
  }
}
```

### File: `hc-dashboard-integration.js`

#### Before (Line 65)
```javascript
async function fetchAndUpdateCaloriesOut(shopifyCustomerId) {
  try {
    const url = `${API_BASE}/health/metrics`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Shopify-Customer-Id': shopifyCustomerId,
        'Content-Type': 'application/json'
      }
    });
    // ...
  }
}
```

#### After (Updated)
```javascript
import { HcAuthService } from './hc-auth-service.js';

async function fetchAndUpdateCaloriesOut(shopifyCustomerId) {
  try {
    const response = await HcAuthService.fetchAuthenticated(
      '/health/metrics',
      { method: 'GET' },
      shopifyCustomerId
    );
    // ...
  }
}
```

---

## Testing the Migration

### Test 1: Generate Token
```bash
curl -X POST https://heirclarkinstacartbackend-production.up.railway.app/api/v1/auth/token \
  -H "Content-Type: application/json" \
  -d '{"shopifyCustomerId":"9339338686771"}'
```

**Expected Response:**
```json
{
  "ok": true,
  "token": "eyJhbGc...",
  "expiresIn": "7d",
  "tokenType": "Bearer",
  "customerId": "9339338686771",
  "message": "Token generated successfully..."
}
```

### Test 2: Use Token to Access Protected Route
```bash
# Save token from Test 1
TOKEN="eyJhbGc..."

curl -X GET https://heirclarkinstacartbackend-production.up.railway.app/api/v1/user/goals \
  -H "Authorization: Bearer $TOKEN"
```

**Expected Response:**
```json
{
  "ok": true,
  "goals": {
    "targetWeight": 180,
    "caloriesTarget": 2200,
    ...
  }
}
```

---

## Migration Checklist

### Frontend Changes Required
- [ ] Create `hc-auth-service.js` with HcAuthService class
- [ ] Update `hc-calorie-counter-core.js` to use HcAuthService
- [ ] Update `hc-dashboard-integration.js` to use HcAuthService
- [ ] Update any other files making API calls to use HcAuthService
- [ ] Remove all instances of `X-Shopify-Customer-Id` header
- [ ] Remove all instances of `shopifyCustomerId` query parameters
- [ ] Test token generation on page load
- [ ] Test authenticated API calls
- [ ] Test token caching (verify only one token request per 7 days)
- [ ] Test token refresh when expired
- [ ] Add error handling for token generation failures

### Testing Checklist
- [ ] Calorie counter page loads without 401 errors
- [ ] User goals fetch successfully
- [ ] Health metrics fetch successfully
- [ ] Token is stored in localStorage
- [ ] Token is reused on subsequent requests
- [ ] Token refresh works after expiration
- [ ] All API endpoints work with new authentication

---

## Timeline

### Immediate (Today)
1. Backend deployed with `/api/v1/auth/token` endpoint ✅
2. Frontend team notified of new authentication requirement

### Short-term (This Week)
1. Create `hc-auth-service.js`
2. Update calorie-counter page to use JWT tokens
3. Update dashboard integration to use JWT tokens
4. Deploy frontend changes to production
5. Verify all 401 errors resolved

### Long-term (Next 2 Weeks)
1. Update all frontend pages to use HcAuthService
2. Remove all legacy authentication code
3. Add token refresh logic for long sessions
4. Implement automatic re-authentication on token expiry

---

## Support & Troubleshooting

### Common Issues

**Issue 1: 401 Unauthorized after getting token**
- **Cause:** Token might be invalid or expired
- **Solution:** Clear localStorage and generate new token
```javascript
HcAuthService.clearToken();
const newToken = await HcAuthService.getToken(shopifyCustomerId);
```

**Issue 2: Token generation fails with 400 Bad Request**
- **Cause:** Missing or invalid shopifyCustomerId
- **Solution:** Verify shopifyCustomerId is a non-empty string
```javascript
if (!shopifyCustomerId || typeof shopifyCustomerId !== 'string') {
  console.error('Invalid shopifyCustomerId:', shopifyCustomerId);
  return;
}
```

**Issue 3: CORS errors when calling /auth/token**
- **Cause:** Backend CORS not configured for frontend domain
- **Solution:** Backend already has CORS enabled - verify origin

### Getting Help
- **Backend Issues:** Check Railway logs at https://railway.app/
- **Frontend Issues:** Check browser console for error messages
- **API Documentation:** See `/api/v1/auth/health` for health check

---

## Security Notes

1. **Token Expiration:** Tokens expire after 7 days - frontend automatically refreshes
2. **Token Storage:** Stored in localStorage - consider sessionStorage for higher security
3. **Token Transmission:** Always use HTTPS in production
4. **Token Validation:** Backend validates token signature on every request
5. **Customer ID Verification:** Token contains verified customer ID from backend

---

## API Reference

### POST /api/v1/auth/token
Generate a JWT token for authenticated API requests

**Request:**
```json
{
  "shopifyCustomerId": "string (required)"
}
```

**Response (200):**
```json
{
  "ok": true,
  "token": "string (JWT token)",
  "expiresIn": "string (e.g., '7d')",
  "tokenType": "string ('Bearer')",
  "customerId": "string (shopifyCustomerId)",
  "message": "string (success message)"
}
```

**Error (400):**
```json
{
  "ok": false,
  "error": "string (error message)"
}
```

### GET /api/v1/auth/health
Health check for authentication service

**Response (200):**
```json
{
  "ok": true,
  "status": "healthy",
  "service": "authentication",
  "timestamp": "2026-01-11T22:00:00.000Z"
}
```

---

**Last Updated:** January 11, 2026
**Backend Status:** ✅ Deployed to production
**Frontend Status:** ⏳ Migration in progress
