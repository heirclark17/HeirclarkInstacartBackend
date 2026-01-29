# 🚀 Deployment Checklist - AI Integration

**Project:** Heirclark Health App Backend
**Date:** January 28, 2026
**Status:** Ready for Production

---

## ✅ Pre-Deployment Checklist

### Backend Code
- [x] TypeScript compiles without errors (`npx tsc --noEmit`)
- [x] Build succeeds (`npm run build`)
- [x] All endpoints implemented:
  - [x] `POST /api/v1/ai/generate-meal-plan`
  - [x] `POST /api/v1/ai/generate-workout-plan`
  - [x] `POST /api/v1/ai/coach-message`
- [x] Functions exported from `mealPlan.ts`
- [x] Routes mounted in `index.ts`
- [x] Environment variables documented in `.env`

### Documentation
- [x] `AI_INTEGRATION_TEST_GUIDE.md` created
- [x] `IMPLEMENTATION_SUMMARY.md` created
- [x] `DEPLOYMENT_CHECKLIST.md` created (this file)
- [x] Code comments added to all new endpoints
- [x] Type definitions documented

---

## 🔧 Deployment Steps

### Step 1: Configure OpenAI API Key

**Option A: Railway Dashboard**
1. Go to https://railway.app
2. Select `HeirclarkInstacartBackend` project
3. Click "Variables" tab
4. Add new variable:
   - Key: `OPENAI_API_KEY`
   - Value: `sk-proj-...` (get from https://platform.openai.com/api-keys)
5. Click "Save"

**Option B: Railway CLI**
```bash
railway login
railway link
railway env set OPENAI_API_KEY=sk-proj-YOUR_KEY_HERE
```

**Verify Environment Variable:**
```bash
railway env list | grep OPENAI
```

---

### Step 2: Commit and Push to GitHub

```bash
cd HeirclarkInstacartBackend

# Check status
git status

# Add all changes
git add .

# Commit with descriptive message
git commit -m "Add AI workout plans and coach chat endpoints

- Add POST /api/v1/ai/generate-workout-plan (GPT-4.1-mini)
- Add POST /api/v1/ai/coach-message (context-aware coaching)
- Add POST /api/v1/ai/generate-meal-plan (wrapper for existing endpoint)
- Export generateMealPlanWithAI and addImagesToMealPlan from mealPlan.ts
- Mount aiExtraRouter in index.ts at /api/v1/ai
- Add OPENAI_API_KEY environment variable configuration
- Add comprehensive testing guide (AI_INTEGRATION_TEST_GUIDE.md)
- Add implementation summary (IMPLEMENTATION_SUMMARY.md)
- Add deployment checklist (DEPLOYMENT_CHECKLIST.md)

All endpoints tested locally. Ready for production deployment."

# Push to GitHub (triggers Railway auto-deploy)
git push origin main
```

---

### Step 3: Monitor Deployment

**Railway Dashboard:**
1. Go to https://railway.app
2. Select `HeirclarkInstacartBackend` project
3. Click "Deployments" tab
4. Watch deployment progress (usually 2-3 minutes)

**Expected Output:**
```
✓ Building...
✓ Deploying...
✓ Healthy
```

**Railway CLI:**
```bash
railway logs --follow
```

**Expected Logs:**
```
Heirclark backend listening on port 3000
✓ Encryption key validated
GDPR endpoints: /api/v1/gdpr/export, /api/v1/gdpr/delete, /api/v1/gdpr/retention
```

---

### Step 4: Verify Deployment

**Health Check:**
```bash
curl https://heirclarkinstacartbackend-production.up.railway.app/health
```

**Expected Response:**
```
ok
```

**Test Meal Plan Endpoint:**
```bash
curl -X POST https://heirclarkinstacartbackend-production.up.railway.app/api/v1/ai/generate-meal-plan \
  -H "Content-Type: application/json" \
  -H "X-Shopify-Customer-Id: test_user" \
  -d '{
    "preferences": {
      "calorieTarget": 2000,
      "proteinTarget": 150,
      "carbsTarget": 200,
      "fatTarget": 65,
      "dietType": "balanced"
    },
    "days": 7
  }'
```

**Expected Response (within 60 seconds):**
```json
{
  "ok": true,
  "plan": {
    "days": [...],
    "shoppingList": [...],
    "generatedAt": "2026-01-28T...",
    "targets": {...}
  }
}
```

**Test Workout Plan Endpoint:**
```bash
curl -X POST https://heirclarkinstacartbackend-production.up.railway.app/api/v1/ai/generate-workout-plan \
  -H "Content-Type: application/json" \
  -H "X-Shopify-Customer-Id: test_user" \
  -d '{
    "preferences": {
      "fitnessGoal": "strength",
      "experienceLevel": "intermediate",
      "daysPerWeek": 3,
      "sessionDuration": 60,
      "availableEquipment": ["dumbbells", "barbell"]
    },
    "weeks": 4
  }'
```

**Expected Response (within 30 seconds):**
```json
{
  "ok": true,
  "plan": {
    "weeks": [...],
    "progressionGuidelines": "...",
    "warmupRoutine": "...",
    "cooldownRoutine": "..."
  }
}
```

**Test Coach Chat Endpoint:**
```bash
curl -X POST https://heirclarkinstacartbackend-production.up.railway.app/api/v1/ai/coach-message \
  -H "Content-Type: application/json" \
  -H "X-Shopify-Customer-Id: test_user" \
  -d '{
    "message": "How much protein do I need for muscle gain?",
    "context": {
      "mode": "meal",
      "userGoals": {
        "calorieTarget": 2500,
        "proteinTarget": 180
      }
    }
  }'
```

**Expected Response (within 5 seconds):**
```json
{
  "ok": true,
  "response": {
    "message": "For muscle gain, aim for 0.7-1g protein per lb of bodyweight...",
    "timestamp": "2026-01-28T...",
    "mode": "meal"
  }
}
```

---

### Step 5: Check Railway Logs for Errors

```bash
railway logs | grep -i error
```

**No errors expected.** If errors appear, check:
1. `OPENAI_API_KEY` is set correctly
2. Database connection is healthy
3. Environment variables are loaded

---

## 🧪 Post-Deployment Testing

### Test Suite (from `AI_INTEGRATION_TEST_GUIDE.md`)

Run all 10 tests:

1. **Test 1:** AI Meal Plan Generation (60s max)
2. **Test 2:** AI Workout Plan Generation (30s max)
3. **Test 3:** ExerciseDB Form Coach (GIF loading)
4. **Test 4:** AI Coach Chat - Meal Mode
5. **Test 5:** AI Coach Chat - Training Mode
6. **Test 6:** AI Coach Chat - General Mode
7. **Test 7:** Saved Meals Persistence
8. **Test 8:** Instacart Integration
9. **Test 9:** Error Handling (offline, rate limits)
10. **Test 10:** UI Consistency (dark mode, animations)

**How to Test:**
1. Open Heirclark Health app (Expo Go or production build)
2. Follow step-by-step instructions in `AI_INTEGRATION_TEST_GUIDE.md`
3. Mark each test ✅ or ❌
4. Report any failures with error logs

---

## 📊 Monitoring & Alerts

### Railway Metrics to Watch

**Dashboard Metrics:**
- **Response Time:** Should be <60s for meal plans, <30s for workouts, <5s for chat
- **Error Rate:** Should be <1%
- **CPU Usage:** Should stay <80%
- **Memory Usage:** Should stay <512MB

**Set Up Alerts (Optional):**
1. Railway Dashboard → Settings → Alerts
2. Add alert for:
   - Response time > 60s
   - Error rate > 5%
   - Memory usage > 512MB

### OpenAI API Monitoring

**Dashboard:** https://platform.openai.com/usage

**Metrics to Track:**
- **Requests per Day:** Expected ~1000 (based on user activity)
- **Tokens per Day:** Expected ~100k tokens
- **Cost per Day:** Expected $2-5/day (1000 active users)

**Set Usage Limits:**
1. Go to https://platform.openai.com/account/limits
2. Set soft limit: $10/day
3. Set hard limit: $20/day (prevents unexpected costs)

---

## 🐛 Troubleshooting

### Issue 1: Deployment Failed
**Symptom:** Railway shows "Failed" status
**Debug:**
```bash
railway logs
```
**Common Causes:**
- TypeScript compilation error → Check `npx tsc --noEmit`
- Missing environment variable → Check `railway env list`
- Database connection error → Check `DATABASE_URL`

**Fix:** Revert to previous commit and redeploy:
```bash
git revert HEAD
git push origin main
```

---

### Issue 2: Endpoints Return 500 Error
**Symptom:** curl returns `{"ok": false, "error": "Internal server error"}`
**Debug:**
```bash
railway logs | grep -i error
```
**Common Causes:**
- `OPENAI_API_KEY` not set → Add in Railway dashboard
- OpenAI API error → Check https://status.openai.com
- Database query error → Check PostgreSQL logs

**Fix:**
```bash
railway env set OPENAI_API_KEY=sk-proj-...
railway restart
```

---

### Issue 3: Timeout Errors
**Symptom:** Requests fail after 60 seconds
**Debug:**
```bash
railway logs | grep -i timeout
```
**Common Causes:**
- OpenAI API slow (high load)
- Complex meal plan preferences (7 days × 5 meals × detailed recipes)
- Network latency

**Fix:** Increase timeout in `ai.ts`:
```typescript
const timeoutId = setTimeout(() => controller.abort(), 90000); // 90s instead of 60s
```

---

### Issue 4: Rate Limit Exceeded
**Symptom:** `{"ok": false, "error": "Too many AI requests"}`
**Debug:**
```bash
railway logs | grep -i rate
```
**Cause:** User making >10 requests per minute

**Fix:** Adjust rate limit in `ai.ts`:
```typescript
const aiRateLimit = rateLimitMiddleware({
  windowMs: 60000,
  maxRequests: 20, // Increased from 10
  message: 'Too many AI requests, please try again later',
});
```

---

## ✅ Final Checklist

Before marking deployment as complete:

- [ ] Backend deployed to Railway
- [ ] `OPENAI_API_KEY` set in environment
- [ ] Health check returns "ok"
- [ ] Meal plan endpoint tested (returns plan in <60s)
- [ ] Workout plan endpoint tested (returns plan in <30s)
- [ ] Coach chat endpoint tested (returns response in <5s)
- [ ] Error handling tested (rate limits, invalid input)
- [ ] Railway logs show no errors
- [ ] OpenAI API usage monitored (check https://platform.openai.com/usage)
- [ ] Frontend updated to use new endpoints (if needed)
- [ ] Test suite run on production app (10 tests)

---

## 🎉 Success Criteria

**Deployment is successful when:**
1. ✅ All 3 new endpoints return valid responses
2. ✅ No errors in Railway logs (past 1 hour)
3. ✅ OpenAI API usage within expected range (<$5/day)
4. ✅ Frontend can generate meal plans, workout plans, and use coach chat
5. ✅ All 10 tests in `AI_INTEGRATION_TEST_GUIDE.md` pass

---

## 📞 Rollback Plan

**If deployment fails:**

### Step 1: Revert Code
```bash
cd HeirclarkInstacartBackend
git log --oneline -5  # Find previous commit hash
git revert <commit-hash>
git push origin main
```

### Step 2: Verify Rollback
```bash
curl https://heirclarkinstacartbackend-production.up.railway.app/health
```

### Step 3: Investigate Issue
```bash
railway logs > deployment_failure.log
```

Send `deployment_failure.log` for debugging.

---

**Deployment Prepared By:** AI Assistant (Claude Sonnet 4.5)
**Date:** January 28, 2026
**Status:** ✅ Ready for Production
