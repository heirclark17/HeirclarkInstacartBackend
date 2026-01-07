# SmartGrocery Skill

## Purpose
Analyze user's weekly nutrition intake versus their goals and generate intelligent Instacart shopping suggestions to fill nutritional gaps (protein, carbs, fats, micronutrients).

## Instructions

### 1. Analyze Nutrition Gaps

Query the user's logged meals for the past 7 days and compare against their goals:

```
Gap Analysis Formula:
- gap_calories = goal_calories - avg_daily_calories
- gap_protein = goal_protein - avg_daily_protein
- gap_carbs = goal_carbs - avg_daily_carbs
- gap_fat = goal_fat - avg_daily_fat
```

Flag significant gaps:
- **Critical**: >20% below goal
- **Moderate**: 10-20% below goal
- **Minor**: 5-10% below goal

### 2. Generate Smart Suggestions

For each nutritional gap, suggest foods from USDA database via OpenNutrition MCP:

| Gap Type | Suggested Foods |
|----------|-----------------|
| Protein deficit | Chicken breast, Greek yogurt, eggs, whey protein, cottage cheese, tuna |
| Carb deficit | Oats, rice, sweet potato, banana, whole grain bread, quinoa |
| Fat deficit | Avocado, olive oil, nuts, salmon, nut butter, cheese |
| Fiber low | Broccoli, beans, berries, chia seeds, whole grains |
| Overall calories | Calorie-dense whole foods matching macro needs |

### 3. Prioritize Based on User Preferences

Consider:
- Dietary restrictions (vegetarian, keto, allergies)
- Past purchase history
- Budget constraints
- Cooking skill level
- Storage/freshness (shelf life)

### 4. Optimize Instacart List

Generate shopping list that:
- Fills identified gaps efficiently
- Minimizes cost per macro
- Groups items by store section
- Suggests quantities for 1 week
- Includes alternatives for out-of-stock items

## Response Format

```json
{
  "user_id": string,
  "analysis_period": {
    "start_date": "YYYY-MM-DD",
    "end_date": "YYYY-MM-DD",
    "days_logged": number
  },
  "nutrition_summary": {
    "avg_daily": {
      "calories": number,
      "protein_g": number,
      "carbs_g": number,
      "fat_g": number,
      "fiber_g": number
    },
    "goals": {
      "calories": number,
      "protein_g": number,
      "carbs_g": number,
      "fat_g": number,
      "fiber_g": number
    },
    "gaps": {
      "calories": { "amount": number, "percent": number, "severity": string },
      "protein_g": { "amount": number, "percent": number, "severity": string },
      "carbs_g": { "amount": number, "percent": number, "severity": string },
      "fat_g": { "amount": number, "percent": number, "severity": string },
      "fiber_g": { "amount": number, "percent": number, "severity": string }
    }
  },
  "recommendations": [
    {
      "food_name": string,
      "reason": string,
      "fills_gap": ["protein", "fiber"],
      "nutrition_per_serving": {
        "serving_size": string,
        "calories": number,
        "protein_g": number,
        "carbs_g": number,
        "fat_g": number
      },
      "suggested_quantity": string,
      "estimated_price": number,
      "usda_fdc_id": string,
      "priority": "high" | "medium" | "low"
    }
  ],
  "instacart_list": {
    "store": string,
    "items": [
      {
        "name": string,
        "quantity": number,
        "unit": string,
        "category": string,
        "estimated_price": number,
        "product_id": string | null
      }
    ],
    "subtotal": number,
    "deep_link": string
  },
  "weekly_impact": {
    "if_purchased": {
      "projected_daily_calories": number,
      "projected_daily_protein": number,
      "projected_daily_carbs": number,
      "projected_daily_fat": number,
      "gaps_filled_percent": number
    }
  },
  "tips": string[]
}
```

## Integration Points

### OpenNutrition MCP
- Search for gap-filling foods
- Validate nutrition data
- Get serving size conversions

### Instacart API
- Search products by name
- Get current prices
- Check availability
- Generate cart deep links

### PostgreSQL Database
- Query user meal history: `SELECT * FROM meals WHERE user_id = ? AND date >= ?`
- Get user preferences: `SELECT * FROM user_preferences WHERE user_id = ?`
- Get user goals: `SELECT * FROM user_goals WHERE user_id = ?`

## Example Workflow

```
User: "What should I buy this week to hit my protein goals?"

1. Query DB: User averaging 120g protein/day, goal is 165g
2. Gap identified: -45g protein daily (27% deficit - CRITICAL)
3. Query OpenNutrition: High-protein foods
4. Filter by: User is lactose-intolerant, budget: moderate
5. Suggest:
   - Chicken breast (31g protein/100g) - 2 lbs
   - Canned tuna (26g protein/can) - 4 cans
   - Eggs (6g protein/egg) - 18 ct
   - Plant-based protein powder - 1 container
6. Generate Instacart link with items
7. Project: If purchased + consumed, will hit 158g/day (96% of goal)
```

## Cost Optimization

Calculate "protein per dollar" or "macro per dollar" to suggest best value:

```
Score = (target_macro_amount / price) * freshness_factor * preference_match
```

Freshness factors:
- Frozen/canned: 1.0 (long shelf life)
- Refrigerated: 0.9 (use within week)
- Fresh produce: 0.8 (use within days)

## Error Handling

- If no meal data logged, suggest starting with basic staples
- If Instacart unavailable, provide generic grocery list
- If budget not specified, assume "moderate" tier
- If preferences conflict with suggestions, explain tradeoffs
