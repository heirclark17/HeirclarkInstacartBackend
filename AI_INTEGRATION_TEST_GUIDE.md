# AI Integration Testing Guide
## Heirclark Health App - Backend Endpoints

**Status:** Backend endpoints implemented ✅
**Date:** January 28, 2026
**Backend:** Railway (https://heirclarkinstacartbackend-production.up.railway.app)
**Frontend:** Expo Go / EAS Update

---

## 📋 Pre-Test Setup

### 1. Environment Variables

**Backend `.env` (Required):**
```env
OPENAI_API_KEY=sk-proj-... # GET FROM: https://platform.openai.com/api-keys
OPENAI_MODEL=gpt-4.1-mini   # Cost-effective model for fast responses
DATABASE_URL=postgresql://... # Railway provides this automatically
```

**Frontend `.env` (Optional):**
```env
EXPO_PUBLIC_API_URL=https://heirclarkinstacartbackend-production.up.railway.app
EXPO_PUBLIC_EXERCISEDB_API_KEY=... # Optional - ExerciseDB API key for GIFs
```

### 2. Deploy Backend to Railway

```bash
cd HeirclarkInstacartBackend
git add .
git commit -m "Add AI workout plans and coach chat endpoints"
git push origin main
```

Railway auto-deploys on push to `main` branch.

**Verify deployment:**
```bash
curl https://heirclarkinstacartbackend-production.up.railway.app/health
# Expected: "ok"
```

### 3. Update Frontend (if needed)

```bash
cd HeirclarkHealthAppNew
npx expo prebuild --clean
eas update --branch production
```

---

## 🧪 Test Suite

### Test 1: AI Meal Plan Generation ✅

**Endpoint:** `POST /api/v1/ai/generate-meal-plan`

**What it tests:**
- GPT-4.1-mini meal plan generation
- 7-day structured plan with macros
- Unsplash image integration
- Database persistence (PostgreSQL)
- AsyncStorage caching

**Steps:**
1. Open Heirclark Health app
2. Navigate to `/goals` tab
3. Complete onboarding wizard:
   - Set calorie target (e.g., 2000)
   - Set macro targets (150g protein, 200g carbs, 65g fat)
   - Select diet type (balanced, high-protein, etc.)
   - Add food preferences (proteins, vegetables, cuisines)
   - Add hated foods (CRITICAL TEST - verify these are excluded)
   - Set cheat days (verify these show advice instead of meals)
4. Click "Generate AI Meal Plan"
5. Wait up to 60 seconds (GPT-4.1-mini processing + Unsplash images)

**Expected Results:**
- ✅ 7-day plan generated with 3 meals/day (or meals + snacks if selected)
- ✅ Each meal has:
  - Dish name (e.g., "Grilled Chicken with Roasted Vegetables")
  - Description
  - Calories, protein, carbs, fat
  - Unsplash food image
  - Recipe (ingredients, instructions, prep/cook time)
- ✅ Daily totals match targets ±5%
- ✅ Hated foods NEVER appear in any meal
- ✅ Cheat days show motivational advice instead of meals
- ✅ Plan persists in AsyncStorage (survive app restart)
- ✅ Saved to database (visible in "Saved Meals" tab)

**Error Cases to Test:**
- ❌ No OPENAI_API_KEY → Error message
- ❌ Network timeout → Retry prompt
- ❌ Invalid preferences → Validation error
- ❌ Rate limit exceeded → Backoff message

---

### Test 2: AI Workout Plan Generation 🆕

**Endpoint:** `POST /api/v1/ai/generate-workout-plan`

**What it tests:**
- GPT-4.1-mini workout plan generation
- 4-week structured training program
- Exercise selection based on equipment
- Injury avoidance logic

**Steps:**
1. Navigate to `/programs` tab
2. Click "Generate AI Training Plan"
3. Fill workout preferences:
   - Fitness goal: Strength / Endurance / Weight Loss / Muscle Gain
   - Experience: Beginner / Intermediate / Advanced
   - Days per week: 3-7
   - Session duration: 30-90 minutes
   - Equipment: Dumbbells, Barbell, Bodyweight, Gym, Home
   - Injuries (optional): e.g., "lower back pain"
4. Submit and wait 30-60 seconds

**Expected Results:**
- ✅ 4-week plan generated with workouts
- ✅ Each workout has:
  - Day of week (Monday, Wednesday, Friday, etc.)
  - Workout type (Full Body, Upper Body, Lower Body, Cardio)
  - Duration (matches preference)
  - 4-6 exercises with:
    - Exercise name (e.g., "Barbell Squat")
    - Sets, reps, rest periods
    - Form cues and safety notes
- ✅ No exercises aggravating declared injuries
- ✅ Equipment matches what user has available
- ✅ Difficulty matches experience level
- ✅ Progression guidelines included (e.g., "Increase weight 5% each week")
- ✅ Warmup and cooldown routines included

**Error Cases to Test:**
- ❌ No OPENAI_API_KEY → Error message
- ❌ Invalid preferences (0 days/week) → Validation error
- ❌ Timeout → Retry prompt

---

### Test 3: ExerciseDB Form Coach 🎥

**Service:** `exerciseDbService.ts` (Frontend only - no backend endpoint)

**What it tests:**
- ExerciseDB API integration (1300+ exercises)
- GIF loading for form demonstrations
- 30-day cache (reduce API calls)
- Fallback database (50+ exercises offline)

**Steps:**
1. Navigate to `/programs` tab
2. Select any exercise from library
3. Tap "Form Guide" button
4. View exercise details

**Expected Results:**
- ✅ Exercise GIF loads (animated demonstration)
- ✅ Instructions displayed (step-by-step)
- ✅ Target muscles highlighted
- ✅ Equipment listed
- ✅ Cached for 30 days (subsequent loads instant)
- ✅ Fallback works offline (50+ exercises available without internet)

**Test Offline Mode:**
1. Enable airplane mode
2. Try viewing exercise
3. Verify fallback database provides details

---

### Test 4: AI Coach Chat (3 Modes) 💬

**Endpoint:** `POST /api/v1/ai/coach-message`

**What it tests:**
- Context-aware GPT-4.1-mini responses
- Conversation history (last 10 messages)
- Mode-specific coaching (meal, training, general)

**Mode 1: Meal Coach (Green)**
1. Navigate to meal plan
2. Click green coach icon
3. Ask nutrition questions:
   - "Is Greek yogurt better than regular yogurt?"
   - "How much protein do I need for muscle gain?"
   - "Can I eat carbs at night?"

**Expected:**
- ✅ Responses reference user's calorie/protein targets
- ✅ Considers recent meals (if available)
- ✅ Concise (2-3 sentences)
- ✅ Evidence-based advice
- ✅ Encouraging tone

**Mode 2: Training Coach (Blue)**
1. Navigate to workout plan
2. Click blue coach icon
3. Ask fitness questions:
   - "How do I improve my squat form?"
   - "Should I train to failure?"
   - "What's a good shoulder warmup?"

**Expected:**
- ✅ Responses reference user's fitness goal
- ✅ Considers recent workouts (if available)
- ✅ Focus on form and safety
- ✅ Progressive overload guidance
- ✅ Motivating tone

**Mode 3: General Coach (Purple)**
1. Navigate to main screen
2. Click purple coach icon
3. Ask general health questions:
   - "How do I stay motivated?"
   - "Should I count calories or macros?"
   - "How much sleep do I need?"

**Expected:**
- ✅ Holistic health advice
- ✅ Considers both nutrition and fitness goals
- ✅ Practical and actionable
- ✅ Supportive tone

**Test Conversation Memory:**
1. Ask: "What should I eat for breakfast?"
2. Coach responds with suggestions
3. Follow-up: "What about snacks?" (no context repeated)
4. Coach should understand "snacks" relates to previous meal discussion

---

### Test 5: Saved Meals Management 💾

**Endpoint:** N/A (Frontend AsyncStorage + Backend `/api/v1/meal-library`)

**What it tests:**
- AsyncStorage persistence
- Filtering and search
- Favorites toggle
- Database sync

**Steps:**
1. Generate AI meal plan (Test 1)
2. Navigate to "Saved" tab in meals screen
3. View auto-saved meals (21 meals from 7-day plan)
4. Test filters:
   - Filter by meal type (Breakfast, Lunch, Dinner)
   - Filter by favorites (toggle favorite on 3 meals)
   - Search by name (e.g., "chicken")
5. Delete a meal
6. Close app and reopen
7. Verify data persists

**Expected Results:**
- ✅ All 21 meals from AI plan auto-saved
- ✅ Filters work correctly
- ✅ Search returns relevant results
- ✅ Favorite toggle updates immediately
- ✅ Delete removes meal
- ✅ Data survives app restart
- ✅ Syncs to backend database

---

### Test 6: Instacart Integration 🛒

**Endpoint:** `POST /api/v1/ai/instacart-order` (existing)

**What it tests:**
- Shopping list generation from meal plan
- Ingredient aggregation (combine duplicate items)
- Instacart API deep link

**Steps:**
1. Generate AI meal plan (Test 1)
2. Click "Order Groceries" button
3. Review shopping list
4. Click "Open Instacart"

**Expected Results:**
- ✅ Shopping list generated with all ingredients
- ✅ Duplicates combined (e.g., "2 cups chicken breast" + "1 cup chicken breast" = "3 cups")
- ✅ Ingredients grouped by category (produce, protein, dairy, etc.)
- ✅ Instacart app/website opens with pre-filled cart
- ✅ Fallback to search if Instacart API unavailable

---

### Test 7: UI Consistency & Design 🎨

**What it tests:**
- Liquid glass design system
- Dark/light theme
- Animations (Reanimated)
- Typography (Urbanist font)

**Steps:**
1. Navigate through all screens
2. Toggle dark/light mode
3. Observe animations (card entries, modal transitions)

**Expected Results:**
- ✅ All cards use `GlassCard` component (frosted glass effect)
- ✅ Urbanist font used throughout
- ✅ Consistent spacing and padding
- ✅ Smooth animations (60fps)
- ✅ Dark mode works correctly (no white flashes)

---

### Test 8: Error Handling 🚨

**What it tests:**
- Backend offline graceful degradation
- OpenAI rate limiting
- ExerciseDB timeout fallback
- Network interruption recovery

**Test 8a: Backend Offline**
1. Stop Railway backend (or simulate network error)
2. Try generating meal plan
3. Expected: User-friendly error message with retry button

**Test 8b: OpenAI Rate Limit**
1. Make 10+ meal plan requests quickly
2. Expected: Rate limit message + backoff timer

**Test 8c: ExerciseDB Timeout**
1. Set short timeout (2 seconds)
2. Request exercise with slow API
3. Expected: Fallback to local database

**Test 8d: Network Interruption**
1. Start meal plan generation
2. Toggle airplane mode mid-request
3. Expected: Timeout error + retry option

---

## 📊 Success Criteria

| Test | Status | Notes |
|------|--------|-------|
| Test 1: AI Meal Plan | ⬜ | Must complete in <60s |
| Test 2: AI Workout Plan | ⬜ | Must complete in <30s |
| Test 3: ExerciseDB Form Coach | ⬜ | GIF must load or fallback |
| Test 4: AI Coach Chat (Meal) | ⬜ | Response <5s |
| Test 4: AI Coach Chat (Training) | ⬜ | Response <5s |
| Test 4: AI Coach Chat (General) | ⬜ | Response <5s |
| Test 5: Saved Meals | ⬜ | Persist after restart |
| Test 6: Instacart Integration | ⬜ | Deep link opens |
| Test 7: UI Consistency | ⬜ | No visual bugs |
| Test 8: Error Handling | ⬜ | All cases covered |

---

## 🐛 Known Issues & Workarounds

### Issue 1: OpenAI API Key Not Set
**Symptom:** "OPENAI_API_KEY not configured" error
**Fix:** Add key to Railway environment variables:
```bash
railway env set OPENAI_API_KEY=sk-proj-...
```

### Issue 2: ExerciseDB Rate Limit (30 requests/min)
**Symptom:** Exercise GIFs fail to load after 30 requests
**Fix:** 30-day cache implemented - subsequent loads use cached data

### Issue 3: Meal Plan Images Missing
**Symptom:** Meals generate but no images
**Fix:** Curated Unsplash library (40+ images) used as fallback

### Issue 4: Workout Plan Too Generic
**Symptom:** Exercises don't match equipment
**Fix:** Provide detailed preferences (equipment list, injuries, goals)

---

## 🚀 Deployment Checklist

**Backend (Railway):**
- [ ] `OPENAI_API_KEY` set in environment
- [ ] `DATABASE_URL` set (auto-configured by Railway)
- [ ] Deployed to production
- [ ] Health check passes (`/health` returns "ok")

**Frontend (Expo):**
- [ ] `EXPO_PUBLIC_API_URL` points to Railway backend
- [ ] EAS update pushed to production branch
- [ ] Metro compiles without errors
- [ ] No infinite loops in console

---

## 📝 API Endpoint Reference

### Meal Plan Generation
```http
POST /api/v1/ai/generate-meal-plan
Content-Type: application/json

{
  "preferences": {
    "calorieTarget": 2000,
    "proteinTarget": 150,
    "carbsTarget": 200,
    "fatTarget": 65,
    "dietType": "balanced",
    "mealsPerDay": 3,
    "allergies": ["peanuts"],
    "favoriteProteins": ["chicken", "salmon"],
    "hatedFoods": "Brussels sprouts, liver",
    "cheatDays": ["Saturday"]
  },
  "days": 7
}
```

**Response:**
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

### Workout Plan Generation
```http
POST /api/v1/ai/generate-workout-plan
Content-Type: application/json

{
  "preferences": {
    "fitnessGoal": "muscle_gain",
    "experienceLevel": "intermediate",
    "daysPerWeek": 4,
    "sessionDuration": 60,
    "availableEquipment": ["dumbbells", "barbell", "gym"],
    "injuries": ["lower back pain"]
  },
  "weeks": 4
}
```

**Response:**
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

### AI Coach Chat
```http
POST /api/v1/ai/coach-message
Content-Type: application/json

{
  "message": "How much protein do I need for muscle gain?",
  "context": {
    "mode": "meal",
    "userGoals": {
      "calorieTarget": 2500,
      "proteinTarget": 180,
      "fitnessGoal": "muscle_gain"
    },
    "conversationHistory": [
      { "role": "user", "content": "What should I eat for breakfast?" },
      { "role": "assistant", "content": "Try Greek yogurt with..." }
    ]
  }
}
```

**Response:**
```json
{
  "ok": true,
  "response": {
    "message": "For muscle gain, aim for 0.7-1g protein per lb bodyweight...",
    "timestamp": "2026-01-28T...",
    "mode": "meal"
  }
}
```

---

## 🔗 External Dependencies

| Service | Purpose | Rate Limit | Fallback |
|---------|---------|------------|----------|
| OpenAI API | Meal plans, workouts, coach | 10k RPM | Generic templates |
| ExerciseDB | Exercise GIFs + data | 30/min | 50+ local exercises |
| Unsplash | Meal images | 50/hr | Curated 40+ library |
| Instacart API | Shopping cart | 100/hr | Search URL fallback |

---

## 📞 Support & Troubleshooting

**Backend Logs (Railway):**
```bash
railway logs
```

**Frontend Logs (Expo):**
```bash
npx expo start
# Check Metro console for errors
```

**Database Inspection (Railway PostgreSQL):**
```bash
railway run psql
```

**Common Errors:**
- `OPENAI_API_KEY not configured` → Add to Railway env
- `Rate limit exceeded` → Wait 1 minute
- `Timeout` → Check Railway backend status
- `Invalid JSON` → Check OpenAI response format

---

**Last Updated:** January 28, 2026
**Backend Version:** 1.0.0 (AI Integration Complete)
**Frontend Version:** 1.0.0 (100% Feature Complete)
