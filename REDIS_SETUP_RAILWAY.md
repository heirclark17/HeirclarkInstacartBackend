# Add Redis to Railway - Quick Setup Guide

**Time Required:** 2 minutes
**Purpose:** Enable Redis-backed rate limiting (fixes critical penetration test finding)

---

## ⚡ Quick Steps

### 1. Open Your Railway Project
https://railway.app/project/heirclarkinstacartbackend-production

### 2. Add Redis Plugin

**Option A: From Dashboard**
1. Click **"+ New"** button in your project
2. Select **"Database"**
3. Choose **"Add Redis"**
4. Railway will automatically:
   - Create Redis instance
   - Set `REDIS_URL` environment variable
   - Connect it to your backend service

**Option B: From Service Settings**
1. Click on your backend service
2. Go to **"Settings"** tab
3. Scroll to **"Plugins"**
4. Click **"+ Add Plugin"**
5. Select **"Redis"**

### 3. Verify Connection

Railway will automatically redeploy your backend. Check logs:

```bash
# Look for this message in Railway logs:
[RateLimit] Redis connected successfully
[RateLimit] Initializing Redis-backed rate limiter
```

### 4. Test Rate Limiting

Run the test script:

```bash
cd "C:\Users\derri\OneDrive\Desktop\HeirclarkInstacartBackend"
node test-railway-env.js
```

Or test manually:

```bash
# Send 110 requests to test rate limiting
for i in {1..110}; do
  curl -s -o /dev/null -w "%{http_code}\n" \
    https://heirclarkinstacartbackend-production.up.railway.app/health
done | grep "429" | wc -l

# Expected output: At least 10 (the last 10 requests should be blocked)
```

---

## 📊 What This Fixes

**Before Redis:**
- ❌ Rate limiting not working
- ❌ All 110 requests succeeded (penetration test)
- ❌ API vulnerable to abuse/DoS attacks

**After Redis:**
- ✅ Rate limiting works across multiple containers
- ✅ First 100 requests succeed, next 10 blocked (429)
- ✅ Protection against API abuse

---

## 🔧 Railway Redis Details

**Plan:** Free tier (100MB)
**Persistence:** Yes (Redis AOF)
**Network:** Private (only your services can access)
**Connection:** Automatic via `REDIS_URL` environment variable

**REDIS_URL Format:**
```
redis://default:password@redis.railway.internal:6379
```

---

## ⚠️ Troubleshooting

### Issue: "Redis connection error" in logs

**Check:**
1. Redis plugin is running (green status in Railway dashboard)
2. `REDIS_URL` environment variable is set
3. Backend service has been redeployed after adding Redis

**Fix:**
```bash
# Force redeploy from Railway CLI
railway up --service backend
```

### Issue: Rate limiting still not working

**Check:**
```bash
# Test that Redis is accessible
curl https://heirclarkinstacartbackend-production.up.railway.app/health

# Check Railway logs for:
[RateLimit] Redis connected successfully

# If you see "Using in-memory fallback" instead:
# → Redis plugin not properly connected
# → REDIS_URL not set
```

**Fix:** Verify Redis plugin is linked to backend service in Railway dashboard.

---

## 💰 Cost

**Free Tier:**
- 100MB storage
- 10,000 commands/month
- **Should be sufficient** for rate limiting (stores simple counters)

**Upgrade Needed If:**
- You exceed 1M API requests/month (unlikely)
- You need more than 100MB (rate limiting uses ~1KB per user)

**Expected Usage:**
- Each rate-limited request: ~50 bytes in Redis
- 100MB supports ~2,000,000 rate limit entries
- Entries auto-expire after 1 minute

---

## ✅ Verification Checklist

After adding Redis:

- [ ] Redis plugin shows "Active" in Railway dashboard
- [ ] `REDIS_URL` appears in service environment variables
- [ ] Backend logs show "[RateLimit] Redis connected successfully"
- [ ] Rate limiting test blocks requests after limit (test with 110-request script)
- [ ] Security score improves: 62.5/100 → 82.5/100

---

## 📈 Impact on Security Score

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Rate Limiting | ❌ 0% | ✅ 100% | +100% |
| API Abuse Protection | ❌ None | ✅ Full | +100% |
| DoS Protection | ❌ None | ✅ Full | +100% |
| Overall Security Score | 🟡 62.5/100 | 🟢 82.5/100 | +20 points |

---

## 🚀 What's Next

After Redis is added:

1. **Today:** Re-run penetration tests to verify fixes
2. **Week 1:** Apply authMiddleware to remaining 26 routes
3. **Week 2:** Apply input validation to all routes
4. **Week 3:** Final security audit

**Target:** 97.5/100 security score (✅ Excellent)

---

**Questions?** Check Railway logs or run: `node test-railway-env.js`
