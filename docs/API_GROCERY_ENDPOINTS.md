# Grocery & Meal Planning API Documentation

Base URL: `https://heirclarkinstacartbackend-production.up.railway.app/api/v1/grocery`

---

## POST /plan-to-instacart

**Single endpoint to generate a personalized meal plan and create an Instacart shopping cart.**

This endpoint combines AI meal planning with Instacart cart creation in one call. It generates a 7-day meal plan based on your nutrition goals, dietary restrictions, and budget, then automatically creates an Instacart shopping cart with all the groceries you need.

### Request

```http
POST /api/v1/grocery/plan-to-instacart
Content-Type: application/json
```

### Request Body

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `daily_calories` | number | No | 2000 | Target daily calorie intake |
| `daily_protein_g` | number | No | 150 | Target daily protein in grams |
| `daily_carbs_g` | number | No | 200 | Target daily carbohydrates in grams |
| `daily_fat_g` | number | No | 70 | Target daily fat in grams |
| `dietary_restrictions` | string[] | No | [] | Diet types: `"gluten-free"`, `"dairy-free"`, `"vegetarian"`, `"vegan"`, `"keto"`, `"paleo"` |
| `allergies` | string[] | No | [] | Food allergies: `"shellfish"`, `"peanuts"`, `"tree-nuts"`, `"eggs"`, `"soy"`, `"fish"` |
| `cuisine_preferences` | string[] | No | [] | Preferred cuisines: `"american"`, `"mediterranean"`, `"asian"`, `"mexican"`, `"italian"` |
| `cooking_skill` | string | No | "intermediate" | Skill level: `"beginner"`, `"intermediate"`, `"advanced"` |
| `max_prep_time_minutes` | number | No | 45 | Maximum meal prep time |
| `meals_per_day` | number | No | 3 | Number of meals per day (2-5) |
| `weekly_budget_cents` | number | No | - | Weekly grocery budget in cents |
| `budget_tier` | string | No | - | Budget level: `"budget"`, `"moderate"`, `"premium"` |
| `preferred_stores` | string[] | No | ["instacart"] | Preferred grocery stores |
| `pantry_items` | object[] | No | [] | Items already in your pantry |
| `landing_url` | string | No | "https://heirclark.com/meal-plan" | Return URL for Instacart |

### Pantry Item Object

```json
{
  "name": "chicken breast",
  "quantity": 2,
  "unit": "lb"
}
```

### Example Request

```bash
curl -X POST "https://heirclarkinstacartbackend-production.up.railway.app/api/v1/grocery/plan-to-instacart" \
  -H "Content-Type: application/json" \
  -d '{
    "daily_calories": 2200,
    "daily_protein_g": 180,
    "daily_carbs_g": 200,
    "daily_fat_g": 70,
    "dietary_restrictions": ["gluten-free", "dairy-free"],
    "allergies": ["shellfish", "peanuts"],
    "cuisine_preferences": ["mediterranean", "asian"],
    "cooking_skill": "beginner",
    "max_prep_time_minutes": 30,
    "meals_per_day": 3,
    "budget_tier": "moderate",
    "pantry_items": [
      {"name": "rice", "quantity": 2, "unit": "lb"},
      {"name": "olive oil", "quantity": 1, "unit": "bottle"},
      {"name": "eggs", "quantity": 12, "unit": "large"},
      {"name": "chicken breast", "quantity": 1, "unit": "lb"}
    ]
  }'
```

### Response

```json
{
  "ok": true,
  "data": {
    "plan": {
      "id": "70e05472-83ed-4285-8d28-b7e1829a143e",
      "days": [
        {
          "day": 1,
          "day_name": "Monday",
          "meals": [
            {
              "meal_type": "breakfast",
              "name": "Scrambled Eggs & Quinoa",
              "servings": 1,
              "ingredients": [
                {"name": "Eggs", "amount": 3, "unit": "large"},
                {"name": "Quinoa", "amount": 50, "unit": "g"}
              ],
              "nutrients": {
                "calories": 420,
                "protein_g": 28,
                "carbs_g": 35,
                "fat_g": 18
              }
            },
            {
              "meal_type": "lunch",
              "name": "Grilled Chicken Salad",
              "servings": 1,
              "ingredients": [
                {"name": "Chicken Breast", "amount": 150, "unit": "g"},
                {"name": "Mixed Greens", "amount": 100, "unit": "g"}
              ],
              "nutrients": {
                "calories": 450,
                "protein_g": 45,
                "carbs_g": 15,
                "fat_g": 22
              }
            },
            {
              "meal_type": "dinner",
              "name": "Baked Salmon & Sweet Potato",
              "servings": 1,
              "ingredients": [
                {"name": "Salmon Fillet", "amount": 150, "unit": "g"},
                {"name": "Sweet Potato", "amount": 200, "unit": "g"}
              ],
              "nutrients": {
                "calories": 650,
                "protein_g": 42,
                "carbs_g": 55,
                "fat_g": 28
              }
            }
          ],
          "daily_totals": {
            "calories": 1520,
            "protein_g": 115,
            "carbs_g": 105,
            "fat_g": 68
          }
        }
        // ... days 2-7
      ],
      "weekly_totals": {
        "calories": 15400,
        "protein_g": 1260,
        "carbs_g": 1400,
        "fat_g": 490
      },
      "weekly_cost_cents": 8500,
      "grocery_list": [
        {
          "name": "Quinoa",
          "total_amount": 300,
          "unit": "g",
          "category": "Grains"
        },
        {
          "name": "Salmon Fillet",
          "total_amount": 450,
          "unit": "g",
          "category": "Protein"
        },
        {
          "name": "Sweet Potato",
          "total_amount": 600,
          "unit": "g",
          "category": "Vegetables"
        }
        // ... more items
      ]
    },
    "instacart": {
      "cart_url": "https://customers.dev.instacart.tools/store/shopping_lists/9255591",
      "items_count": 9
    },
    "pantry_savings_cents": 2286
  }
}
```

### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `plan.id` | string | Unique plan identifier |
| `plan.days` | array | 7-day meal plan with daily meals |
| `plan.weekly_totals` | object | Aggregated nutrition for the week |
| `plan.weekly_cost_cents` | number | Estimated grocery cost in cents |
| `plan.grocery_list` | array | Consolidated shopping list |
| `instacart.cart_url` | string | Direct link to Instacart cart |
| `instacart.items_count` | number | Number of items in cart |
| `pantry_savings_cents` | number | Money saved from pantry items |

### Error Response

```json
{
  "ok": false,
  "error": "Failed to generate meal plan with Instacart cart",
  "details": "Specific error message"
}
```

---

## GET /budget-tiers

**Get available budget tier options.**

### Request

```http
GET /api/v1/grocery/budget-tiers
```

### Response

```json
{
  "ok": true,
  "data": [
    {
      "name": "budget",
      "description": "Budget-friendly meals",
      "weekly_range": {
        "min_cents": 5000,
        "max_cents": 7500
      },
      "daily_range": {
        "min_cents": 714,
        "max_cents": 1071
      }
    },
    {
      "name": "moderate",
      "description": "Balanced quality and cost",
      "weekly_range": {
        "min_cents": 7500,
        "max_cents": 12500
      },
      "daily_range": {
        "min_cents": 1071,
        "max_cents": 1785
      }
    },
    {
      "name": "premium",
      "description": "High-quality ingredients",
      "weekly_range": {
        "min_cents": 12500,
        "max_cents": 20000
      },
      "daily_range": {
        "min_cents": 1785,
        "max_cents": 2857
      }
    }
  ]
}
```

---

## POST /plan-with-cart

**Generate meal plan with additional optimization options.**

This is the original full-featured endpoint with more response data including budget optimization suggestions and AI explanations.

### Request Body

Same as `/plan-to-instacart` plus:

| Field | Type | Description |
|-------|------|-------------|
| `generate_cart` | boolean | Whether to generate Instacart cart data (default: true) |
| `optimize_budget` | boolean | Run budget optimizer if over budget |
| `prioritize_sales` | boolean | Prioritize items on sale |

### Response

Includes additional fields:
- `explanation` - AI-generated description of the meal plan
- `pantry_adjustment` - Details about pantry item deductions
- `budget_optimization` - Suggestions if over budget
- `budget_swaps` - Alternative ingredient suggestions for savings

---

## POST /compare-stores

**Compare prices across different grocery stores.**

### Request

```json
{
  "grocery_list": [
    {"name": "Chicken Breast", "total_amount": 2, "unit": "lb"},
    {"name": "Brown Rice", "total_amount": 1, "unit": "lb"}
  ]
}
```

### Response

```json
{
  "ok": true,
  "data": {
    "comparisons": [
      {
        "store": "walmart",
        "total_cents": 1250,
        "estimated_savings_vs_avg": 150
      },
      {
        "store": "instacart",
        "total_cents": 1400,
        "estimated_savings_vs_avg": 0
      }
    ],
    "recommendation": "walmart",
    "potential_savings": 150
  }
}
```

---

## POST /optimize-cart

**Optimize an existing grocery list for a target budget.**

### Request

```json
{
  "grocery_list": [
    {"name": "Salmon", "total_amount": 2, "unit": "lb"},
    {"name": "Quinoa", "total_amount": 1, "unit": "lb"}
  ],
  "target_budget_cents": 5000,
  "preferred_stores": ["instacart"]
}
```

---

## Usage Examples

### Basic High-Protein Plan

```bash
curl -X POST ".../api/v1/grocery/plan-to-instacart" \
  -H "Content-Type: application/json" \
  -d '{
    "daily_protein_g": 200,
    "daily_calories": 2500,
    "meals_per_day": 4
  }'
```

### Keto Diet Plan

```bash
curl -X POST ".../api/v1/grocery/plan-to-instacart" \
  -H "Content-Type: application/json" \
  -d '{
    "daily_calories": 1800,
    "daily_carbs_g": 30,
    "daily_fat_g": 140,
    "daily_protein_g": 100,
    "dietary_restrictions": ["keto"]
  }'
```

### Budget-Friendly Family Plan

```bash
curl -X POST ".../api/v1/grocery/plan-to-instacart" \
  -H "Content-Type: application/json" \
  -d '{
    "daily_calories": 2000,
    "budget_tier": "budget",
    "cooking_skill": "beginner",
    "max_prep_time_minutes": 20,
    "pantry_items": [
      {"name": "rice", "quantity": 5, "unit": "lb"},
      {"name": "beans", "quantity": 2, "unit": "cans"}
    ]
  }'
```

---

## Rate Limits

- 10 requests per minute per IP for Instacart-related endpoints
- AI meal plan generation may take 20-40 seconds

## Environment

- **Production**: Uses Instacart production API
- **Development**: Uses Instacart dev sandbox (cart URLs point to dev.instacart.tools)
