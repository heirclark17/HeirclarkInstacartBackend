# MCP Credentials Setup Guide

**Status:** Environment variables added to Railway with placeholders ✅
**Action Required:** Update placeholders with real credentials

---

## REQUIRED CREDENTIALS

### 1. Fitbit OAuth Credentials 🏃

**Get Credentials:**
1. Go to https://dev.fitbit.com/apps
2. Click "Register a New App"
3. Fill in application details:
   - **Application Name:** Heirclark Nutrition App
   - **Description:** Fitness data integration for nutrition tracking
   - **Application Website:** https://heirclark.com
   - **Organization:** Your organization name
   - **OAuth 2.0 Application Type:** Server
   - **Callback URL:** `https://heirclarkinstacartbackend-production.up.railway.app/api/v1/integrations/fitbit/callback`
   - **Default Access Type:** Read-Only
4. Accept terms and create app
5. Copy **Client ID** and **Client Secret**

**Update Railway Variables:**
```bash
railway variables --set "FITBIT_CLIENT_ID=your_actual_client_id_here"
railway variables --set "FITBIT_CLIENT_SECRET=your_actual_client_secret_here"
```

---

### 2. Google Fit OAuth Credentials 🏃‍♀️

**Get Credentials:**
1. Go to https://console.cloud.google.com/
2. Create new project or select existing one
3. Enable **Fitness API**:
   - Go to "APIs & Services" → "Library"
   - Search for "Fitness API"
   - Click "Enable"
4. Create OAuth 2.0 Credentials:
   - Go to "APIs & Services" → "Credentials"
   - Click "Create Credentials" → "OAuth client ID"
   - Application type: **Web application**
   - Name: Heirclark Nutrition App
   - Authorized redirect URIs: `https://heirclarkinstacartbackend-production.up.railway.app/api/v1/integrations/google-fit/callback`
5. Copy **Client ID** and **Client Secret**

**Update Railway Variables:**
```bash
railway variables --set "GOOGLE_CLIENT_ID=your_actual_client_id_here"
railway variables --set "GOOGLE_CLIENT_SECRET=your_actual_client_secret_here"
```

---

### 3. OpenWeatherMap API Key 🌤️

**Get API Key:**
1. Go to https://home.openweathermap.org/users/sign_up
2. Create free account
3. Go to https://home.openweathermap.org/api_keys
4. Copy default API key (or generate new one)

**Free Tier Limits:**
- 1,000 API calls per day
- 60 calls per minute
- Current weather, forecasts, air quality included

**Update Railway Variable:**
```bash
railway variables --set "OPENWEATHERMAP_API_KEY=your_actual_api_key_here"
```

**Usage in App:**
- Weather widget on dashboard
- Weather-based meal recommendations
- Hydration reminders based on temperature

---

### 4. USDA FoodData Central API Key (Optional) 🍎

**Get API Key:**
1. Go to https://fdc.nal.usda.gov/api-key-signup.html
2. Fill in request form (name, email, organization)
3. Agree to terms
4. API key sent via email (usually instant)

**Free Tier:**
- No rate limits
- Access to 900,000+ food items
- Enhanced nutrition data for Nutri-MCP

**Update Railway Variable:**
```bash
railway variables --set "USDA_API_KEY=your_actual_api_key_here"
```

**Note:** Nutri-MCP works without this (uses Open Food Facts), but USDA enhances accuracy for micronutrients.

---

## VERIFICATION CHECKLIST

After updating credentials, verify each integration:

### Fitbit Integration
```bash
# Test OAuth flow
curl https://heirclarkinstacartbackend-production.up.railway.app/api/v1/integrations/fitbit/auth

# Should redirect to Fitbit authorization page
```

### Google Fit Integration
```bash
# Test OAuth flow
curl https://heirclarkinstacartbackend-production.up.railway.app/api/v1/integrations/google-fit/auth

# Should redirect to Google authorization page
```

### OpenWeatherMap Integration
```bash
# Test weather endpoint (after deployment)
curl "https://heirclarkinstacartbackend-production.up.railway.app/api/v1/mcp/weather/current?lat=29.7604&lon=-95.3698" \
  -H "x-shopify-customer-id: test-customer"

# Should return current weather data
```

---

## CURRENT STATUS IN RAILWAY

Run this command to check current variables:
```bash
cd /c/Users/derri/HeirclarkInstacartBackend
railway variables | grep -E "(FITBIT|GOOGLE|OPENWEATHER|USDA)"
```

**Current Values (as of setup):**
- `FITBIT_CLIENT_ID` = `PLACEHOLDER_UPDATE_IN_RAILWAY_DASHBOARD`
- `FITBIT_CLIENT_SECRET` = `PLACEHOLDER_UPDATE_IN_RAILWAY_DASHBOARD`
- `GOOGLE_CLIENT_ID` = `PLACEHOLDER_UPDATE_IN_RAILWAY_DASHBOARD`
- `GOOGLE_CLIENT_SECRET` = `PLACEHOLDER_UPDATE_IN_RAILWAY_DASHBOARD`
- `OPENWEATHERMAP_API_KEY` = `PLACEHOLDER_GET_FROM_OPENWEATHERMAP_ORG`
- `USDA_API_KEY` = `OPTIONAL_ENHANCES_FOOD_DATA`

---

## ALTERNATIVE: Update Via Railway Dashboard

If you prefer GUI over CLI:

1. Go to https://railway.app/
2. Select project "gracious-perfection"
3. Click on your service
4. Go to "Variables" tab
5. Find each variable and click "Edit"
6. Paste actual credential value
7. Click "Save"
8. Railway will automatically redeploy

---

## SECURITY BEST PRACTICES

✅ **DO:**
- Store credentials in Railway environment variables (encrypted at rest)
- Use read-only scopes when possible (Fitbit default access type)
- Rotate API keys periodically (every 90 days)
- Monitor API usage in provider dashboards

❌ **DON'T:**
- Commit credentials to Git
- Share API keys in Slack/email
- Use production keys in development (create separate dev apps)
- Exceed rate limits (causes API blocks)

---

## TROUBLESHOOTING

### "Invalid client ID" error
- Double-check Client ID matches exactly (no extra spaces)
- Verify app is approved in Fitbit/Google dashboard
- Check redirect URI matches Railway deployment URL

### "Rate limit exceeded" error
- OpenWeatherMap: 1,000/day limit hit (implement 15-min caching)
- Fitbit: 150/hour limit hit (spread out sync requests)
- Google Fit: Usually no limit, check project quotas

### "Authentication failed" error
- Client secret might be incorrect
- OAuth flow redirect URI mismatch
- User denied permissions

---

## NEXT STEPS

After updating credentials:

1. ✅ Deploy to Railway (environment variables will be loaded)
2. ✅ Test OAuth flows from frontend
3. ✅ Sync test data from each provider
4. ✅ Verify data appears in `hc_health_history` table
5. ✅ Monitor audit logs in `hc_mcp_audit_log`

---

**Questions?**
- Fitbit OAuth docs: https://dev.fitbit.com/build/reference/web-api/developer-guide/authorization/
- Google Fit docs: https://developers.google.com/fit/rest/v1/get-started
- OpenWeatherMap docs: https://openweathermap.org/api

**Ready to deploy once credentials are updated!** 🚀
