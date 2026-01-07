# BudgetMeals Skill

## Purpose
Generate nutritious meal plans optimized for cost, helping users eat healthy without breaking the bank through smart ingredient selection, seasonal buying, and store brand recommendations.

## Core Responsibilities

1. **Budget-Constrained Planning** - Create meal plans within specified weekly budget
2. **Cost Optimization** - Suggest swaps that reduce cost without sacrificing nutrition
3. **Seasonal Awareness** - Recommend produce that's in-season and cheaper
4. **Store Strategy** - Advise on where to shop for best value

## Data Sources

- `GET /api/v1/user/goals` - Nutrition targets
- `GET /api/v1/preferences` - Dietary restrictions
- Internal pricing database (average prices by item)
- Seasonal produce calendar

## Budget Tiers

```
Tight Budget: $40-60/week per person
- Focus on: beans, eggs, frozen vegetables, store brands
- Protein sources: eggs, canned tuna, chicken thighs, beans
- Minimize: fresh berries, beef, pre-cut produce

Moderate Budget: $60-90/week per person
- Balanced approach
- Mix of fresh and frozen produce
- Some variety in protein sources

Comfortable Budget: $90-120/week per person
- Full flexibility
- Fresh produce preferred
- Variety in proteins including fish

No Budget Limit: $120+/week per person
- Optimize purely for nutrition and preference
- Organic options where beneficial
- Premium ingredients available
```

## Cost-Per-Nutrient Optimization

```python
def calculate_protein_value(item):
    """Find best protein bang for buck"""
    cost_per_gram_protein = item.price / item.protein_grams
    return {
        'item': item.name,
        'cost_per_20g_protein': cost_per_gram_protein * 20,
        'rating': 'excellent' if cost_per_gram_protein < 0.10 else
                  'good' if cost_per_gram_protein < 0.20 else
                  'moderate' if cost_per_gram_protein < 0.35 else 'expensive'
    }

# Typical results:
# Eggs: $0.08 per 20g protein (excellent)
# Chicken thighs: $0.12 per 20g protein (excellent)
# Canned beans: $0.10 per 20g protein (excellent)
# Ground beef: $0.18 per 20g protein (good)
# Chicken breast: $0.22 per 20g protein (good)
# Salmon: $0.45 per 20g protein (moderate)
# Shrimp: $0.55 per 20g protein (expensive)
```

## Budget-Friendly Swaps

```
Expensive → Budget Alternative (Savings)
-----------------------------------------
Chicken breast → Chicken thighs ($2/lb savings)
Fresh salmon → Canned salmon ($8/lb savings)
Fresh berries → Frozen berries ($3/lb savings)
Pre-cut vegetables → Whole vegetables ($2/lb savings)
Name brand oats → Store brand oats ($2/container savings)
Greek yogurt → Regular yogurt + protein powder ($3 savings)
Fresh herbs → Dried herbs ($4 savings)
Quinoa → Brown rice ($3/lb savings)
Almond butter → Peanut butter ($4/jar savings)
Avocado → Banana (similar nutrients, $2 savings)
```

## Seasonal Produce Calendar

```
Spring (Mar-May):
Best buys: Asparagus, artichokes, peas, spinach, strawberries
Avoid: Apples, pears, squash (storage = expensive)

Summer (Jun-Aug):
Best buys: Tomatoes, corn, zucchini, berries, peaches, watermelon
Avoid: Citrus, apples (off-season)

Fall (Sep-Nov):
Best buys: Apples, pears, squash, sweet potatoes, Brussels sprouts
Avoid: Berries, stone fruits (expensive)

Winter (Dec-Feb):
Best buys: Citrus, cabbage, kale, root vegetables, bananas
Avoid: Tomatoes, berries, corn (shipped = expensive + low quality)
```

## Response Format

```json
{
  "ok": true,
  "budget_analysis": {
    "weekly_budget": 75,
    "estimated_cost": 68.50,
    "under_budget_by": 6.50,
    "cost_per_day": 9.79,
    "cost_per_meal": 3.26
  },
  "meal_plan": {
    "days": 7,
    "meals_per_day": 3,
    "total_meals": 21,
    "sample_day": {
      "breakfast": {
        "name": "Veggie Egg Scramble with Toast",
        "cost": 1.85,
        "calories": 420,
        "protein": 24,
        "ingredients": [
          {"item": "Eggs (3)", "cost": 0.75},
          {"item": "Bell pepper (1/4)", "cost": 0.35},
          {"item": "Onion (1/4)", "cost": 0.15},
          {"item": "Whole wheat bread (2 slices)", "cost": 0.40},
          {"item": "Butter (1 tbsp)", "cost": 0.20}
        ]
      },
      "lunch": {
        "name": "Chicken & Rice Bowl",
        "cost": 2.95,
        "calories": 550,
        "protein": 42
      },
      "dinner": {
        "name": "Bean & Vegetable Soup with Bread",
        "cost": 2.45,
        "calories": 480,
        "protein": 22
      },
      "daily_total": {
        "cost": 7.25,
        "calories": 1450,
        "protein": 88
      }
    }
  },
  "shopping_list": {
    "total_estimated": 68.50,
    "by_category": [
      {
        "category": "Proteins",
        "items": [
          {"name": "Chicken thighs (3 lbs)", "price": 8.99, "store": "Costco"},
          {"name": "Eggs (18 count)", "price": 4.49, "store": "Aldi"},
          {"name": "Canned black beans (4)", "price": 3.96, "store": "Walmart"}
        ],
        "subtotal": 17.44
      },
      {
        "category": "Produce",
        "items": [
          {"name": "Bananas (bunch)", "price": 1.49},
          {"name": "Frozen broccoli (2 bags)", "price": 3.98},
          {"name": "Onions (3 lb bag)", "price": 2.99},
          {"name": "Carrots (2 lb bag)", "price": 1.99}
        ],
        "subtotal": 10.45
      }
    ],
    "money_saving_tips": [
      "Buy chicken thighs instead of breast - same protein, $2/lb cheaper",
      "Frozen broccoli is 40% cheaper than fresh and just as nutritious",
      "Store brand oats and rice are identical to name brand"
    ]
  },
  "store_recommendations": {
    "best_for_bulk": "Costco",
    "best_for_produce": "Aldi or local farmers market",
    "best_for_staples": "Walmart",
    "avoid": "Convenience stores, gas stations"
  },
  "budget_stretch_tips": [
    "Make a big batch of rice on Sunday - lasts all week",
    "Rotisserie chicken ($6) provides 4+ meals",
    "Freeze bread and thaw as needed to prevent waste",
    "Eggs are the best budget protein - use liberally"
  ]
}
```

## Batch Cooking for Budget

```
Budget Batch Meals (serves 4-6, cost $8-12):

1. Chicken & Rice Bowls
   - 2 lbs chicken thighs ($5)
   - 2 cups rice ($0.80)
   - Frozen vegetables ($2)
   - Seasonings ($0.50)
   Total: $8.30 = $1.40/serving

2. Black Bean Soup
   - 2 cans black beans ($2)
   - 1 can diced tomatoes ($1)
   - Onion, garlic, spices ($1.50)
   - Serve with rice ($0.40/serving)
   Total: $6.50 = $1.10/serving

3. Egg Fried Rice
   - 3 cups rice ($0.60)
   - 6 eggs ($1.50)
   - Frozen peas & carrots ($1.50)
   - Soy sauce, oil ($0.50)
   Total: $4.10 = $0.70/serving
```

## API Endpoints Required

```
POST /api/v1/budget-meals/plan        - Generate budget meal plan
GET /api/v1/budget-meals/swaps        - Get budget swap suggestions
GET /api/v1/budget-meals/seasonal     - Current seasonal produce
POST /api/v1/budget-meals/optimize    - Optimize existing plan for cost
GET /api/v1/budget-meals/shopping     - Budget-optimized shopping list
GET /api/v1/budget-meals/tips         - Personalized saving tips
```

## Important Notes

- Never sacrifice protein for budget - find cheaper protein sources instead
- Frozen vegetables are nutritionally equivalent to fresh
- Buying in bulk only saves money if you'll use it before it spoils
- Generic/store brands are often identical to name brands
- Meal planning itself saves money by reducing food waste
