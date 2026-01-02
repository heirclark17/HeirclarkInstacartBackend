# RAG (Retrieval-Augmented Generation) System Documentation

## Table of Contents
1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Database Schema](#database-schema)
4. [How It Works](#how-it-works)
5. [API Endpoints](#api-endpoints)
6. [Data Sources](#data-sources)
7. [Seeding & Populating Data](#seeding--populating-data)
8. [Configuration](#configuration)
9. [Troubleshooting](#troubleshooting)
10. [Best Practices](#best-practices)

---

## Overview

The RAG (Retrieval-Augmented Generation) system enhances the HeirClark nutrition app's AI meal estimation by grounding responses in a curated knowledge base of nutrition data. Instead of relying solely on the LLM's training data, RAG retrieves relevant nutrition facts from our database and includes them in the prompt, resulting in:

- **More accurate macro estimates** - Based on verified nutrition data
- **Consistent answers** - Same foods always return similar values
- **Explainable AI** - Responses cite their sources
- **Customizable** - Add your own nutrition rules and restaurant data

### Key Benefits

| Without RAG | With RAG |
|-------------|----------|
| LLM guesses macros from training data | LLM uses verified nutrition database |
| Inconsistent estimates | Consistent, reproducible results |
| No explanation of sources | Cites specific foods and portions |
| Can't add custom data | Easy to add restaurants, rules |
| May hallucinate numbers | Grounded in real data |

---

## Architecture

```
                                    ┌─────────────────────────────────────┐
                                    │         RAG SYSTEM FLOW             │
                                    └─────────────────────────────────────┘

┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   User       │     │   Backend    │     │  RAG Service │     │   OpenAI     │
│   Request    │────▶│   Endpoint   │────▶│   Retrieval  │────▶│   GPT-4o     │
│              │     │              │     │              │     │              │
│ "grilled     │     │ /api/v1/     │     │ Search for   │     │ Estimate     │
│  chicken     │     │ nutrition/   │     │ "chicken"    │     │ with context │
│  with rice"  │     │ estimate     │     │ in database  │     │              │
└──────────────┘     └──────────────┘     └──────────────┘     └──────────────┘
                                                 │
                                                 ▼
                                    ┌──────────────────────┐
                                    │   PostgreSQL         │
                                    │   ─────────────────  │
                                    │   rag_documents      │
                                    │   rag_chunks         │
                                    │   ai_request_logs    │
                                    └──────────────────────┘
```

### Components

| Component | File | Purpose |
|-----------|------|---------|
| RAG Service | `src/services/rag/ragService.ts` | Document ingestion, chunking, retrieval |
| RAG AI Service | `src/services/rag/ragAiService.ts` | LLM integration, prompt building |
| Types | `src/services/rag/types.ts` | TypeScript interfaces |
| Database Pool | `src/db/pool.ts` | PostgreSQL connection |
| Migration | `src/db/migrations/004-rag-no-vector.sql` | Table schemas |

---

## Database Schema

### rag_documents

Stores metadata about each document in the knowledge base.

```sql
CREATE TABLE rag_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL UNIQUE,
    source TEXT NOT NULL,           -- 'seed', 'usda', 'user_feedback', etc.
    doc_type TEXT NOT NULL,         -- 'rules', 'food', 'portion', etc.
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Document Types:**
- `rules` - Estimation rules and guidelines
- `food` / `macro_data` - Nutrition facts for foods
- `portion` / `portion_rules` - Portion size guidelines
- `conversion` / `cooking_methods` - Cooking conversions
- `support` / `swap_suggestions` - Healthier swap recommendations
- `confidence_rubric` - Confidence scoring guidelines

**Document Sources:**
- `seed` - Manual seed scripts
- `usda` - USDA FoodData Central API
- `open_food_facts` - Open Food Facts database
- `user_feedback` - User corrections
- `nutritionist` - Professional input
- `api` - External API imports

### rag_chunks

Stores text chunks with optional embeddings for similarity search.

```sql
CREATE TABLE rag_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID REFERENCES rag_documents(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    chunk_text TEXT NOT NULL,
    chunk_metadata JSONB DEFAULT '{}',
    embedding_json TEXT,            -- JSON array of floats (optional)
    tokens INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Text similarity search index
CREATE INDEX idx_rag_chunks_text_trgm ON rag_chunks
    USING gin (chunk_text gin_trgm_ops);
```

### ai_request_logs

Audit log for all AI requests (SOC2 compliance).

```sql
CREATE TABLE ai_request_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shopify_customer_id TEXT,
    mode TEXT NOT NULL,             -- 'meal_text', 'meal_photo', 'barcode'
    query_text TEXT,
    image_hash TEXT,
    retrieved_chunk_ids JSONB,
    llm_model TEXT,
    llm_response JSONB,
    confidence INTEGER,
    processing_time_ms INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## How It Works

### Step 1: Document Ingestion

When you run a seed script, documents are:

1. **Chunked** - Split into ~500 token chunks with 50 token overlap
2. **Embedded** (optional) - Generate OpenAI embeddings if API key configured
3. **Stored** - Saved to `rag_documents` and `rag_chunks` tables

```typescript
// Example: Ingesting a document
await upsertDocumentWithChunks({
    title: "USDA Common Foods Database",
    source: "usda",
    docType: "macro_data",
    text: "- Chicken breast (4oz): 165 cal, 31g protein, 0g carbs, 3.6g fat\n..."
});
```

### Step 2: Retrieval at Query Time

When a user submits a meal description:

1. **Query Building** - Extract food keywords from user input
2. **Similarity Search** - Find top-K relevant chunks using `pg_trgm` text similarity
3. **Filtering** - Filter by document type (rules, food, portions)
4. **Ranking** - Sort by similarity score

```typescript
// Retrieval function
const chunks = await retrieveForMealEstimation("grilled chicken with rice", 6);
// Returns: [
//   { chunkText: "- Chicken breast (4oz): 165 cal...", similarity: 0.78 },
//   { chunkText: "- White rice (1 cup): 205 cal...", similarity: 0.72 },
//   ...
// ]
```

### Step 3: Prompt Augmentation

Retrieved chunks are formatted and injected into the LLM prompt:

```
## Knowledge Base Context (use for macro values)
[Source 1: USDA Common Foods Database (macro_data, 78% match)]
- Chicken breast (4oz): 165 cal, 31g protein, 0g carbs, 3.6g fat
- Chicken thigh (4oz): 209 cal, 26g protein, 0g carbs, 11g fat
[/Source 1]

[Source 2: Portion Guidelines (portion_rules, 72% match)]
Protein portions: 4-6 oz (113-170g) cooked
[/Source 2]

## User's Meal Description
"grilled chicken with rice"
```

### Step 4: LLM Response

The LLM generates a structured response using the context:

```json
{
    "meal_name": "Grilled Chicken with Rice",
    "macros": {
        "calories": { "value": 450 },
        "protein_g": { "value": 35 },
        "carbs_g": { "value": 45 },
        "fats_g": { "value": 8 }
    },
    "confidence": 85,
    "explanation": "Based on USDA data: 4oz chicken breast (165 cal) + 1 cup white rice (205 cal)",
    "explanation_sources": ["chunk_id_1", "chunk_id_2"]
}
```

---

## API Endpoints

### Check RAG Health

```http
GET /api/v1/rag/health
```

**Response:**
```json
{
    "ok": true,
    "pgvector": false,
    "tables": {
        "documents": true,
        "chunks": true,
        "logs": true
    },
    "documentCount": 12,
    "chunkCount": 22
}
```

### Get RAG Stats

```http
GET /api/v1/rag/stats
```

**Response:**
```json
{
    "documents": 12,
    "chunks": 22,
    "sources": ["seed", "usda", "open_food_facts"],
    "docTypes": ["rules", "macro_data", "portion_rules"]
}
```

### Search Chunks (Debug)

```http
POST /api/v1/rag/search
Content-Type: application/json

{
    "query": "chicken breast",
    "k": 5,
    "types": ["macro_data", "food"]
}
```

---

## Data Sources

### Currently Integrated

| Source | Items | API Key Required | Notes |
|--------|-------|------------------|-------|
| USDA FoodData Central | 664+ | Yes (free) | Best for whole foods |
| Open Food Facts | 200+ | No | Best for branded products |
| Curated Restaurant Data | 50+ | No | Chipotle, Chick-fil-A, etc. |
| Curated Grocery Data | 40+ | No | Trader Joe's, Costco, etc. |
| Seed Rules | 7 docs | No | Estimation rules, portions |

### Getting API Keys

**USDA FoodData Central (Recommended)**
1. Visit: https://fdc.nal.usda.gov/api-key-signup.html
2. Fill out the form (instant approval)
3. Set `USDA_API_KEY` environment variable

**CalorieNinjas (Optional)**
1. Visit: https://calorieninjas.com/api
2. Sign up for free tier (10K calls/month)
3. Set `CALORIENINJAS_API_KEY` environment variable

**Nutritionix (Optional, best for restaurants)**
1. Visit: https://developer.nutritionix.com
2. Sign up for free tier (500 calls/month)
3. Set `NUTRITIONIX_APP_ID` and `NUTRITIONIX_API_KEY`

---

## Seeding & Populating Data

### Available Scripts

```bash
# Seed basic rules and patterns (no API key needed)
npm run rag:seed

# Fetch from USDA + curated restaurant/grocery data
npm run rag:fetch

# Fetch from all sources (USDA + Open Food Facts + more)
npm run rag:fetch-all
```

### Running Scripts

```bash
# Set required environment variables
export DATABASE_URL="postgresql://..."
export USDA_API_KEY="your-key-here"

# Run the comprehensive fetch
npm run rag:fetch-all
```

### Expected Output

```
=== Multi-Source Nutrition Data Fetch ===

API Keys configured:
  - USDA: Yes
  - CalorieNinjas: No
  - Nutritionix: No

--- Fetching from USDA FoodData Central ---
  chicken breast grilled... 5 items
  ground beef 90 lean... 5 items
  ...
  Total: 664 items

--- Fetching from Open Food Facts ---
  Chobani greek yogurt... 5 items
  RXBAR... 5 items
  ...
  Total: 200 items

--- Seeding to RAG Database ---
Ingesting: USDA Foods Database (664 items)... 2 chunks
Ingesting: Open Food Facts Foods Database (200 items)... 2 chunks

=== Complete ===
Total Documents: 12
Total Chunks: 22
```

### Adding Custom Data

Create a new seed script or add to existing:

```typescript
// scripts/rag-seed-custom.ts
import { upsertDocumentWithChunks } from '../src/services/rag';

const MY_RESTAURANT_DATA = `
# Local Restaurant Nutrition Data

## Joe's Pizza
- Cheese slice: 285 cal, 12g protein, 36g carbs, 10g fat
- Pepperoni slice: 330 cal, 14g protein, 36g carbs, 14g fat

## Main Street Deli
- Turkey sandwich: 420 cal, 28g protein, 45g carbs, 14g fat
`;

await upsertDocumentWithChunks({
    title: "Local Restaurant Data",
    source: "seed",
    docType: "macro_data",
    text: MY_RESTAURANT_DATA
});
```

---

## Configuration

### Environment Variables

```bash
# Required
DATABASE_URL=postgresql://user:pass@host:port/db

# Optional - OpenAI (for embeddings and LLM)
OPENAI_API_KEY=sk-...

# Optional - LLM model selection
LLM_MODEL=gpt-4o-mini          # Default: gpt-4o-mini
EMBEDDINGS_MODEL=text-embedding-3-small
EMBEDDINGS_DIM=1536

# Optional - Data sources
USDA_API_KEY=your-usda-key
CALORIENINJAS_API_KEY=your-key
NUTRITIONIX_APP_ID=your-app-id
NUTRITIONIX_API_KEY=your-key

# Feature flag
USE_RAG=true                    # Enable RAG for meal estimation
```

### Railway Configuration

Add these in Railway dashboard under Variables:
1. `DATABASE_URL` - Automatically set if using Railway PostgreSQL
2. `OPENAI_API_KEY` - Required for AI estimation
3. `USDA_API_KEY` - For data fetching
4. `USE_RAG=true` - Enable the feature

---

## Troubleshooting

### Common Issues

#### "No relevant knowledge base entries found"

**Cause:** Database has no chunks or similarity search returns no results.

**Fix:**
1. Check if data exists: `SELECT COUNT(*) FROM rag_chunks;`
2. Run seed scripts: `npm run rag:fetch-all`
3. Verify search function: `SELECT * FROM search_rag_chunks_text('chicken', 5, NULL);`

#### "OpenAI not configured, skipping embedding generation"

**Cause:** `OPENAI_API_KEY` not set.

**Impact:** Minimal - text-based search (`pg_trgm`) works without embeddings. Embeddings improve accuracy but aren't required.

**Fix:** Set `OPENAI_API_KEY` in environment variables.

#### USDA API returns 0 items

**Cause:** Using DEMO_KEY which has rate limits, or API key not set.

**Fix:**
1. Get free API key: https://fdc.nal.usda.gov/api-key-signup.html
2. Set `USDA_API_KEY` environment variable
3. Run fetch again

#### "relation rag_documents does not exist"

**Cause:** Migration not run.

**Fix:**
```bash
# Run the RAG migration
psql $DATABASE_URL -f src/db/migrations/004-rag-no-vector.sql
```

### Debugging

```typescript
// Check RAG health
const health = await checkRagHealth();
console.log(health);
// { ok: true, pgvector: false, tables: {...}, documentCount: 12, chunkCount: 22 }

// Test retrieval
const chunks = await retrieveTopK({ query: "chicken", k: 3 });
console.log(chunks);

// Check if retrieval is strong enough
const isStrong = isRetrievalStrong(chunks);
console.log("Strong retrieval:", isStrong);
```

---

## Best Practices

### 1. Keep Data Fresh

- Re-run `npm run rag:fetch-all` periodically to update nutrition data
- Add new restaurants and products as needed
- Monitor user feedback for corrections

### 2. Optimize Chunk Size

- Default: ~500 tokens per chunk with 50 token overlap
- Smaller chunks = more precise retrieval but less context
- Larger chunks = more context but may include irrelevant info

### 3. Balance Sources

- Use USDA for accurate whole food data
- Use Open Food Facts for branded products
- Add custom data for local restaurants

### 4. Monitor Confidence

- RAG responses include confidence scores (0-100)
- Low confidence (<50) = show ranges, ask follow-up questions
- High confidence (>80) = show exact values

### 5. Use Document Types

- Filter by document type for better relevance
- `macro_data` for nutrition facts
- `portion_rules` for serving sizes
- `swap_suggestions` for healthier alternatives

---

## Appendix: File Reference

| File | Purpose |
|------|---------|
| `src/services/rag/ragService.ts` | Core RAG service (chunking, retrieval) |
| `src/services/rag/ragAiService.ts` | LLM integration |
| `src/services/rag/types.ts` | TypeScript interfaces |
| `src/services/rag/index.ts` | Barrel export |
| `src/db/migrations/004-rag-no-vector.sql` | Database schema |
| `scripts/rag-seed.ts` | Basic rules seeding |
| `scripts/rag-fetch-nutrition-data.ts` | USDA + curated data |
| `scripts/rag-fetch-all-sources.ts` | Multi-source fetcher |

---

*Last updated: January 2025*
