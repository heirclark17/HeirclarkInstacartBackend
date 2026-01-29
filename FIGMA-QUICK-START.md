# Figma API - Quick Start Guide

**Production URL:** https://heirclarkinstacartbackend-production.up.railway.app

---

## Test Health Check (No Auth Required)

```bash
curl https://heirclarkinstacartbackend-production.up.railway.app/api/v1/figma/health
```

**Expected Response:**
```json
{
  "status": "ok",
  "message": "Connected as derrick88clark@yahoo.com"
}
```

---

## Get Figma File Key

From any Figma URL, extract the file key:

```
https://www.figma.com/file/ABC123XYZ/My-Design-File
                              ↑↑↑↑↑↑↑↑↑
                            File Key
```

---

## Make Authenticated Requests

All endpoints (except `/health`) require authentication:

### Option 1: Shopify Customer ID
```bash
curl -H "X-Shopify-Customer-Id: YOUR_CUSTOMER_ID" \
  https://heirclarkinstacartbackend-production.up.railway.app/api/v1/figma/file/YOUR_FILE_KEY
```

### Option 2: JWT Token
```bash
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  https://heirclarkinstacartbackend-production.up.railway.app/api/v1/figma/file/YOUR_FILE_KEY
```

---

## Common Use Cases

### 1. Extract Colors from Design
```bash
curl -H "X-Shopify-Customer-Id: 123" \
  https://heirclarkinstacartbackend-production.up.railway.app/api/v1/figma/colors/YOUR_FILE_KEY
```

### 2. Get Component as Image
```bash
curl -H "X-Shopify-Customer-Id: 123" \
  "https://heirclarkinstacartbackend-production.up.railway.app/api/v1/figma/images/YOUR_FILE_KEY?ids=1:2&format=png&scale=2"
```

### 3. Get File Styles
```bash
curl -H "X-Shopify-Customer-Id: 123" \
  https://heirclarkinstacartbackend-production.up.railway.app/api/v1/figma/styles/YOUR_FILE_KEY
```

---

## Available Endpoints

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `/api/v1/figma/health` | ❌ | Check API status |
| `/api/v1/figma/file/:fileKey` | ✅ | Get complete file |
| `/api/v1/figma/nodes/:fileKey?ids=...` | ✅ | Get specific nodes |
| `/api/v1/figma/images/:fileKey?ids=...` | ✅ | Export as images |
| `/api/v1/figma/styles/:fileKey` | ✅ | Get styles |
| `/api/v1/figma/colors/:fileKey` | ✅ | Extract colors |
| `/api/v1/figma/comments/:fileKey` | ✅ | Get comments |

---

## Full Documentation

📖 **See:** `FIGMA-API-DOCUMENTATION.md`

---

## Run Tests

```bash
cd C:\Users\derri\HeirclarkInstacartBackend
npx playwright test tests/figma-integration.spec.ts
```

**Expected:** 9 passing tests

---

**Status:** ✅ Production Ready
**Last Tested:** January 18, 2026
