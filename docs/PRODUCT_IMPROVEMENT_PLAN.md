# Heirclark Product Improvement Plan
## Monopoly-Class Fitness & Nutrition Platform

---

## 1) HIGH-LEVEL ROADMAP

### Horizon 1 (H1): Foundation & Activation (0-3 months)

**Product Bets:**
- 7-Day Onboarding Program with AI Coach avatar guidance
- Nutrition Graph v1: Verified food database with quality scores
- Apple Shortcut → Steps Page integration (complete)
- Budget-aware meal planning with Instacart cart generation

**Technical Epics:**
| Epic | Routes/Services | Target |
|------|----------------|--------|
| nutrition_graph_v1 | `/api/v1/nutrition/foods/*` | 50K verified foods |
| onboarding_program | `/api/v1/programs/onboarding/*` | 7-day completion rate >60% |
| budget_planner | `/api/v1/ai/plan-with-cart` | $50-200/week plans |
| coach_avatar_v2 | `/api/v1/avatar/session/*` | <3s avatar response |

**Key Metrics & Targets:**
- Day 1 Activation: 70% (complete profile + first meal log)
- Day 7 Retention: 45% (vs industry 25-30%)
- 30-Day Retention: 30%
- Grocery Attach Rate: 15% of meal plans → Instacart cart

### Horizon 2 (H2): Behavior Change & Body Intelligence (3-9 months)

**Product Bets:**
- Noom++ Behavior Engine: CBT-based micro-lessons, reflections, habit loops
- Body Recomposition Reports: Scan A vs B with AI narrative
- Grocery Receipt Integration: Close the loop on actual purchases
- Social Features: Friends, challenges, plan sharing

**Technical Epics:**
| Epic | Routes/Services | Target |
|------|----------------|--------|
| behavior_engine_v1 | `/api/v1/programs/*`, `/api/v1/coaching/*` | 8 programs live |
| body_recomp_reports | `/api/v1/body-scan/reports/*` | AI-generated insights |
| receipt_ingestion | `/api/v1/grocery/receipts/*` | Parse 90% of receipts |
| social_graph_v1 | `/api/v1/social/*` | Friends, follows, shares |

**Key Metrics & Targets:**
- Program Completion: 40% finish 4+ week programs
- Body Scan Repeat: 60% take 2nd scan within 8 weeks
- Subscription Conversion: 8% free → paid
- Social Engagement: 30% have 1+ friend connection

### Horizon 3 (H3): Platform & Ecosystem (9-24 months)

**Product Bets:**
- Nutrition OS: API platform for third-party apps
- Coach/Trainer Portal: Manage cohorts, custom programs
- Longevity Dashboard: Metabolic health, biomarker trends
- Import from MyFitnessPal/LoseIt: Migration tools

**Technical Epics:**
| Epic | Routes/Services | Target |
|------|----------------|--------|
| api_platform | `/api/v2/*` with OAuth | 10 partner integrations |
| coach_portal | `/api/v1/coach/*` | 100 active coaches |
| longevity_engine | `/api/v1/longevity/*` | Metabolic age estimation |
| data_import | `/api/v1/import/*` | MFP, LoseIt, CSV support |

**Key Metrics & Targets:**
- API Partners: 10 integrated apps
- Coach-managed Users: 5% of user base
- Data Import Success: 85% of attempted imports
- Platform Revenue: 20% from API/B2B

---

## Route Architecture Summary

```
/api/v1/
├── nutrition/
│   ├── foods/search          [NEW H1]
│   ├── foods/verify          [NEW H1]
│   ├── foods/:id             [NEW H1]
│   └── plan/from-cart        [NEW H1]
├── programs/
│   ├── onboarding            [NEW H1]
│   ├── onboarding/:day/complete [NEW H1]
│   └── :programId/*          [NEW H2]
├── ai/
│   ├── meal-plan-7day        [EXISTS - enhance]
│   ├── plan-with-cart        [NEW H1]
│   └── explain-plan          [NEW H1]
├── body-scan/
│   ├── upload                [EXISTS]
│   ├── reports               [NEW H2]
│   └── reports/generate      [NEW H2]
├── social/
│   ├── friends               [NEW H2]
│   ├── challenges            [NEW H2]
│   └── share                 [NEW H2]
├── grocery/
│   ├── receipts/upload       [NEW H2]
│   └── receipts/parse        [NEW H2]
├── coach/
│   ├── cohorts               [NEW H3]
│   └── programs              [NEW H3]
└── import/
    ├── myfitnesspal          [NEW H3]
    └── csv                   [NEW H3]
```

---

## 2) BACKEND CHANGES

See implementation files:
- `src/db/nutritionGraph.ts`
- `src/routes/nutritionFoods.ts`
- `src/types/nutrition.ts`
- `src/services/nutritionSearch.ts`

## 3) AI / RAG / PROMPTING CHANGES

See implementation files:
- `src/services/mealPlanAI.ts`
- `src/services/aiPromptTemplates.ts`

## 4) RETENTION & BEHAVIOR-CHANGE FLOWS

See implementation files:
- `src/routes/programs.ts`
- `src/types/programs.ts`
- `src/db/programs.ts`

## 5) GROCERY + BUDGET LOOP

See implementation files:
- `src/routes/groceryBudget.ts`
- `src/services/groceryOptimizer.ts`

## 6) BODY SCAN & RECOMPOSITION

See implementation files:
- `src/routes/bodyScanReports.ts`
- `src/types/bodyScan.ts`

## 7) SOCIAL / ECOSYSTEM & SWITCHING COSTS

See implementation files:
- `src/routes/social.ts`
- `src/routes/import.ts`
- `src/types/social.ts`

## 8) IMPLEMENTATION CHECKLIST

### Completed Files ✅

**Nutrition Graph (H1)**
- [x] `src/types/nutrition.ts` - Nutrition food types, verification, cart analysis
- [x] `src/db/nutritionGraph.ts` - SQL schema with pg_trgm fuzzy search, quality scoring
- [x] `src/routes/nutritionFoods.ts` - Search, verify, store mapping, cart analysis endpoints

**AI/RAG System (H1)**
- [x] `src/services/mealPlanAI.ts` - Budget-aware meal planning with OpenAI, pantry integration
- [x] `src/services/aiPromptTemplates.ts` - Centralized prompts for all AI features

**Programs & Behavior Change (H1/H2)**
- [x] `src/types/programs.ts` - Program types, tasks, habit loops, CBT techniques
- [x] `src/db/programs.ts` - Program enrollment, progress tracking, habit completions
- [x] `src/routes/programs.ts` - Full 7-day onboarding with lessons, reflections, quizzes

**Grocery + Budget Loop (H1)**
- [x] `src/routes/groceryBudget.ts` - `/ai/plan-with-cart`, store comparison, optimization
- [x] `src/services/groceryOptimizer.ts` - Budget tiers, substitutions, Instacart cart generation

**Body Scan & Recomposition (H2)**
- [x] `src/types/bodyScan.ts` - Progress photos, measurements, recomp reports, goals
- [x] `src/routes/bodyScanReports.ts` - Photo upload, comparison, AI analysis, reports

**Social & Ecosystem (H2/H3)**
- [x] `src/types/social.ts` - Connections, challenges, shares, badges, notifications
- [x] `src/routes/social.ts` - Friends, challenges, leaderboards, activity feed
- [x] `src/routes/import.ts` - MyFitnessPal/LoseIt/CSV import with rollback

---

### Integration Tasks (Next Steps)

**Wire Up Routes in `src/index.ts`:**
```typescript
import { createNutritionFoodsRouter } from './routes/nutritionFoods';
import { createProgramsRouter } from './routes/programs';
import { createGroceryBudgetRouter } from './routes/groceryBudget';
import { createBodyScanReportsRouter } from './routes/bodyScanReports';
import { createSocialRouter } from './routes/social';
import { createImportRouter } from './routes/import';

// Mount routes
app.use('/api/v1/nutrition', createNutritionFoodsRouter(pool));
app.use('/api/v1/programs', createProgramsRouter(pool));
app.use('/api/v1/ai', createGroceryBudgetRouter(pool));
app.use('/api/v1/body-scan', createBodyScanReportsRouter(pool));
app.use('/api/v1/social', createSocialRouter(pool));
app.use('/api/v1/import', createImportRouter(pool));
```

**Run Database Migrations:**
```sql
-- Run in order:
-- 1. src/db/nutritionGraph.ts → NUTRITION_GRAPH_SCHEMA
-- 2. src/db/programs.ts → PROGRAMS_SCHEMA
-- 3. src/routes/bodyScanReports.ts → (inline tables)
-- 4. src/routes/social.ts → SOCIAL_SCHEMA
-- 5. src/routes/import.ts → IMPORT_SCHEMA
```

**Environment Variables Needed:**
```env
# AI Services
OPENAI_API_KEY=sk-...

# Optional for full features
UNSPLASH_ACCESS_KEY=...  # For meal plan images
FIRECRAWL_API_KEY=...    # For recipe scraping
```

---

### Remaining Development (Future Sprints)

**H1 Completed (Jan 2026):**
- [x] Seed 36K+ verified foods from USDA FoodData Central
- [x] `POST /api/v1/grocery/plan-to-instacart` - Single endpoint meal plan + cart
- [x] Store price estimation and product name mapping
- [x] Pantry item deduction from grocery lists
- [x] API documentation for grocery endpoints

**H1 Remaining:**
- [ ] Avatar coach script generation integration with HeyGen
- [ ] Push notification triggers for onboarding reminders
- [ ] Seed 7-day onboarding program content

**H2 Remaining:**
- [ ] Receipt OCR integration (Google Vision or AWS Textract)
- [ ] Body composition AI analysis using Vision API
- [ ] Challenge auto-scoring cron job
- [ ] Badge awarding logic and triggers
- [ ] Social graph foundation (friends, challenges)
- [ ] Data import from MFP/LoseIt

**H3 Remaining:**
- [ ] Coach portal dashboard and cohort management
- [ ] OAuth2 provider for API platform
- [ ] Longevity metrics engine
- [ ] Rate limiting and API key management

---

## Latest Updates (Jan 2026)

### New Single Endpoint: Plan-to-Instacart

**`POST /api/v1/grocery/plan-to-instacart`**

Combines meal plan generation + Instacart cart creation in one call:

```json
{
  "daily_calories": 2200,
  "daily_protein_g": 180,
  "dietary_restrictions": ["gluten-free"],
  "allergies": ["shellfish"],
  "budget_tier": "moderate",
  "pantry_items": [
    {"name": "rice", "quantity": 2, "unit": "lb"},
    {"name": "eggs", "quantity": 12, "unit": "large"}
  ]
}
```

Response includes:
- 7-day meal plan
- Grocery list (adjusted for pantry)
- Instacart cart URL
- Pantry savings calculation

See full docs: `docs/API_GROCERY_ENDPOINTS.md`
