# Railway Environment Variables Configuration

**Date:** January 11, 2026
**Purpose:** Security hardening - JWT authentication, rate limiting, CORS configuration
**Priority:** 🔴 **CRITICAL** - Required for security fixes to function properly

---

## Required Environment Variables

### 1. JWT_SECRET (CRITICAL)

**Description:** Secret key for HMAC-SHA256 JWT token signing/verification

**Current Status:** ❌ Not set (authMiddleware will return 500 errors)

**Required:** YES - Authentication will fail without this

**How to Generate:**
```bash
# Generate secure 256-bit (32-byte) random key
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Example output: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

**Railway Configuration:**
```bash
# In Railway dashboard:
# Settings > Variables > Add Variable

Variable Name: JWT_SECRET
Variable Value: <paste generated hex string>
```

**Security Notes:**
- Use cryptographically secure random generation
- Never commit to git or share publicly
- Rotate every 90 days for SOC2 compliance
- Minimum 256 bits (32 bytes) entropy

---

### 2. ADMIN_SECRET (HIGH PRIORITY)

**Description:** Secret key for admin API endpoints (`/api/v1/admin/*`)

**Current Status:** ⚠️ Default value: `heirclark-admin-2024` (INSECURE)

**Required:** YES - Admin endpoints are currently insecure

**How to Generate:**
```bash
# Generate secure random string
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# Example output: 8J2dH5kL3mN9pQ7rT6sU4vW2xY0zA1bC3dE5fG7hI9j=
```

**Railway Configuration:**
```bash
Variable Name: ADMIN_SECRET
Variable Value: <paste generated base64 string>
```

**Security Notes:**
- Current default is a security risk (publicly known)
- Change immediately in production
- Share only with authorized administrators
- Never log or display in responses

---

### 3. RATE_LIMIT_WINDOW_MS (MEDIUM PRIORITY)

**Description:** Time window for rate limiting (milliseconds)

**Current Status:** ⚠️ Default: 60000ms (1 minute) - hardcoded

**Required:** NO (defaults work but not configurable)

**Recommended Value:** `60000` (1 minute)

**Railway Configuration:**
```bash
Variable Name: RATE_LIMIT_WINDOW_MS
Variable Value: 60000
```

**Options:**
- `60000` = 1 minute (default, recommended)
- `300000` = 5 minutes (more lenient)
- `15000` = 15 seconds (strict)

---

### 4. RATE_LIMIT_MAX_REQUESTS (MEDIUM PRIORITY)

**Description:** Maximum requests per window per IP

**Current Status:** ⚠️ Default: 100 requests/minute - hardcoded

**Required:** NO (defaults work but not configurable)

**Recommended Value:** `100` (general API), `10` (auth endpoints)

**Railway Configuration:**
```bash
Variable Name: RATE_LIMIT_MAX_REQUESTS
Variable Value: 100
```

**Options:**
- `100` = General API endpoints (default)
- `10` = Authentication endpoints (strict)
- `20` = AI/video generation endpoints
- `5` = Admin endpoints (very strict)

---

### 5. CORS_ALLOWED_ORIGINS (MEDIUM PRIORITY)

**Description:** Comma-separated list of allowed CORS origins

**Current Status:** ⚠️ Hardcoded in `src/index.ts` (not configurable)

**Required:** NO (defaults work but not environment-configurable)

**Recommended Value:**
```
https://heirclark.com,https://www.heirclark.com,https://mduiup-rn.myshopify.com
```

**Railway Configuration:**
```bash
Variable Name: CORS_ALLOWED_ORIGINS
Variable Value: https://heirclark.com,https://www.heirclark.com,https://mduiup-rn.myshopify.com,http://localhost:3000,http://127.0.0.1:3000
```

**Security Notes:**
- ✅ **FIXED:** Added `https://mduiup-rn.myshopify.com` to CORS allowlist in code
- Never use `*` wildcard in production
- Add only trusted domains
- Include localhost for development
- Remove test domains before production

---

### 6. NODE_ENV (REQUIRED BY EXPRESS)

**Description:** Node.js environment (development, production)

**Current Status:** ✅ Should already be set by Railway

**Required:** YES (for security headers, error handling, logging)

**Railway Configuration:**
```bash
Variable Name: NODE_ENV
Variable Value: production
```

**Security Impact:**
- `production` = Minimal error details, security headers enabled
- `development` = Verbose errors, debugging enabled (NEVER use in prod)

---

## Existing Variables (No Changes Needed)

These should already be configured in Railway:

| Variable | Status | Description |
|----------|--------|-------------|
| `DATABASE_URL` | ✅ Required | PostgreSQL connection string |
| `PORT` | ✅ Auto-set | Railway assigns port automatically |
| `USDA_API_KEY` | ✅ Optional | USDA Food Database API key |
| `OPENAI_API_KEY` | ✅ Optional | OpenAI GPT-4 for meal planning |
| `FITBIT_CLIENT_ID` | ✅ Optional | Fitbit OAuth integration |
| `FITBIT_CLIENT_SECRET` | ✅ Optional | Fitbit OAuth secret |
| `INSTACART_API_KEY` | ✅ Optional | Instacart cart generation |

---

## Configuration Steps

### Step 1: Login to Railway

```bash
# Navigate to project
https://railway.app/project/<project-id>

# Or use Railway CLI
railway login
railway environment production
```

### Step 2: Set Critical Variables (DO THIS FIRST)

```bash
# Option 1: Railway Dashboard
1. Go to project > Variables tab
2. Click "New Variable"
3. Add JWT_SECRET (generated value)
4. Add ADMIN_SECRET (generated value)
5. Click "Deploy"

# Option 2: Railway CLI
railway variables set JWT_SECRET=<generated_value>
railway variables set ADMIN_SECRET=<generated_value>
```

### Step 3: Set Optional Variables

```bash
# Rate limiting configuration
railway variables set RATE_LIMIT_WINDOW_MS=60000
railway variables set RATE_LIMIT_MAX_REQUESTS=100

# CORS configuration (optional - already hardcoded in src/index.ts)
railway variables set CORS_ALLOWED_ORIGINS="https://heirclark.com,https://www.heirclark.com,https://mduiup-rn.myshopify.com"
```

### Step 4: Verify Configuration

```bash
# Railway will automatically redeploy after variable changes
# Check logs for errors:
railway logs

# Look for these startup messages:
# ✅ "[auth] JWT_SECRET configured"
# ✅ "[server] Listening on port 8080"
# ✅ "[cors] Allowed origins: ..."

# ❌ Error messages to watch for:
# "[auth] JWT_SECRET not configured" → JWT_SECRET missing
# "[admin] Using default ADMIN_SECRET" → ADMIN_SECRET not changed
```

### Step 5: Test Authentication

```bash
# Test JWT authentication endpoint (once implemented)
curl https://heirclarkinstacartbackend-production.up.railway.app/api/v1/auth/token \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"customerId": "test_customer_123"}'

# Expected response:
# {
#   "ok": true,
#   "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
# }
```

---

## Security Best Practices

### Secret Rotation Schedule

| Variable | Rotation Frequency | Priority |
|----------|-------------------|----------|
| JWT_SECRET | Every 90 days | 🔴 Critical |
| ADMIN_SECRET | Every 180 days | 🟠 High |
| API Keys | Per vendor policy | 🟡 Medium |

### Secret Storage

- ✅ Store in Railway environment variables (encrypted at rest)
- ✅ Use separate values for dev/staging/production
- ❌ Never commit secrets to git
- ❌ Never log secrets in application code
- ❌ Never send secrets in API responses

### Access Control

- Only backend engineers should have Railway project access
- Use Railway role-based access control (RBAC)
- Audit variable changes in Railway logs
- Revoke access immediately when team members leave

---

## Monitoring & Alerts

### Key Metrics to Monitor

1. **Authentication Failures**
   - Spike in 401 errors → potential attack
   - Check: Railway logs for `[auth] Invalid or expired JWT token`

2. **Rate Limit Hits**
   - 429 responses → API abuse or need to adjust limits
   - Check: Railway logs for `[rate-limit] Rate limit exceeded`

3. **CORS Errors**
   - Browser console errors → unauthorized origin
   - Check: Railway logs for `[cors] Origin not allowed`

### Alert Configuration

```bash
# Set up Railway alerts (if available)
# Or use external monitoring:

# 1. Sentry error tracking
# 2. Datadog APM
# 3. New Relic monitoring
# 4. Custom Slack webhook for critical errors
```

---

## Troubleshooting

### Issue: "JWT_SECRET not configured" Error

**Cause:** JWT_SECRET environment variable not set

**Fix:**
```bash
# Generate new secret
JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

# Set in Railway
railway variables set JWT_SECRET=$JWT_SECRET

# Redeploy (automatic)
```

### Issue: Authentication Always Fails

**Symptoms:** All API calls return 401 Unauthorized

**Debugging:**
```bash
# Check Railway logs
railway logs --filter "auth"

# Look for:
# "[auth] JWT_SECRET not configured" → Set JWT_SECRET
# "[auth] Invalid or expired JWT token" → Token generation issue
# "[auth] No authentication provided" → Client not sending token
```

### Issue: CORS Errors in Browser

**Symptoms:** Frontend can't make API calls

**Debugging:**
```bash
# Check browser console for:
# "Access to fetch blocked by CORS policy"

# Fix 1: Verify CORS allowlist includes frontend domain
# src/index.ts line 187 should include your Shopify store

# Fix 2: Check request headers
# Ensure frontend sends: Origin: https://mduiup-rn.myshopify.com
```

### Issue: Rate Limiting Too Strict

**Symptoms:** Legitimate users getting 429 errors

**Fix:**
```bash
# Increase rate limit
railway variables set RATE_LIMIT_MAX_REQUESTS=200

# Or increase window
railway variables set RATE_LIMIT_WINDOW_MS=120000  # 2 minutes
```

---

## Deployment Checklist

Before deploying security fixes to production:

- [ ] JWT_SECRET generated and set in Railway
- [ ] ADMIN_SECRET changed from default value
- [ ] NODE_ENV set to `production`
- [ ] CORS allowlist includes all production domains
- [ ] Rate limiting configured appropriately
- [ ] Backend redeployed with new environment variables
- [ ] Authentication tested with curl/Postman
- [ ] Frontend tested (legacy auth still works during transition)
- [ ] Railway logs monitored for errors
- [ ] Backup plan ready if rollback needed

---

## Support & Questions

**Security Engineer:** Backend Team
**Date Created:** January 11, 2026
**Last Updated:** January 11, 2026
**Related Documents:**
- `IDOR_SECURITY_FINDINGS.md` - Authentication vulnerability details
- `BACKEND-SECURITY-NOTES.md` - Original security audit
- `SECURITY-TEST-RESULTS.md` - E2E test results

**Railway Project URL:** https://railway.app/project/<project-id>

**Emergency Contact:**
- If JWT_SECRET is compromised, rotate immediately and invalidate all tokens
- If DATABASE_URL is exposed, rotate database password and update Railway

---

**End of Railway Environment Variables Configuration**
