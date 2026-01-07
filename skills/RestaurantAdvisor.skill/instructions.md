# RestaurantAdvisor Skill

## Purpose
Help users make smart nutrition choices when eating at restaurants by providing personalized menu recommendations based on their remaining daily macros and dietary preferences.

## Core Responsibilities

1. **Menu Analysis** - Parse and understand restaurant menu items
2. **Macro Matching** - Find items that fit user's remaining daily budget
3. **Customization Advice** - Suggest modifications to make dishes healthier
4. **Chain Database** - Maintain nutrition data for major restaurant chains

## Data Sources

- `GET /api/v1/user/goals` - User's daily targets
- `GET /api/v1/nutrition/day-summary` - Today's consumed macros
- `GET /api/v1/preferences` - Dietary restrictions/preferences
- Restaurant nutrition databases (built-in)

## Supported Restaurant Chains

### Fast Casual
- Chipotle
- Sweetgreen
- Panera Bread
- Cava
- Chopt
- Just Salad

### Fast Food
- Chick-fil-A
- McDonald's
- Wendy's
- Subway
- Taco Bell
- In-N-Out

### Casual Dining
- Olive Garden
- Applebee's
- Chili's
- Texas Roadhouse
- Red Robin
- Buffalo Wild Wings

### Coffee Shops
- Starbucks
- Dunkin'
- Peet's Coffee

## Recommendation Algorithm

```python
def recommend_meal(restaurant, remaining_macros, preferences):
    # 1. Filter by dietary restrictions
    eligible_items = filter_by_restrictions(menu, preferences.restrictions)

    # 2. Score each item
    for item in eligible_items:
        score = calculate_fit_score(item, remaining_macros)
        # Factors:
        # - Calorie fit (within 80-120% of ideal)
        # - Protein density (higher = better)
        # - Macro balance match
        # - User preference alignment

    # 3. Return top 3 recommendations with customization tips
    return sorted(eligible_items, by=score)[:3]
```

## Fit Score Calculation

```
calorie_fit = 100 - abs(item_calories - ideal_calories) / ideal_calories * 100
protein_score = (item_protein / item_calories * 100) * 2  # Protein density bonus
preference_bonus = 10 if matches_cuisine_preference else 0
restriction_penalty = -100 if violates_restriction else 0

total_score = calorie_fit + protein_score + preference_bonus + restriction_penalty
```

## Response Format

```json
{
  "ok": true,
  "restaurant": "Chipotle",
  "remaining_budget": {
    "calories": 750,
    "protein": 45,
    "carbs": 80,
    "fat": 30
  },
  "recommendations": [
    {
      "rank": 1,
      "name": "Chicken Burrito Bowl",
      "base_nutrition": {
        "calories": 665,
        "protein": 53,
        "carbs": 55,
        "fat": 24
      },
      "customization": {
        "build": [
          "Chicken (double protein +200cal, +32g protein)",
          "Brown rice (half portion)",
          "Black beans",
          "Fajita veggies",
          "Fresh tomato salsa",
          "Lettuce"
        ],
        "skip": ["Cheese", "Sour cream", "Guacamole (save 230 cal)"],
        "why": "Maximizes protein while keeping calories in budget"
      },
      "final_nutrition": {
        "calories": 665,
        "protein": 53,
        "carbs": 55,
        "fat": 24
      },
      "fit_score": 92
    }
  ],
  "general_tips": [
    "Ask for dressing on the side",
    "Grilled > fried always",
    "Double protein is usually worth the extra cost"
  ]
}
```

## Customization Rules

### Calorie-Saving Swaps
```
- Cheese → Skip (saves 100-150 cal)
- Sour cream → Skip or salsa (saves 100-150 cal)
- Fried → Grilled (saves 100-200 cal)
- Mayo → Mustard (saves 90 cal)
- Full dressing → Half or side (saves 100-200 cal)
- Bun → Lettuce wrap (saves 150-200 cal)
- Fries → Side salad (saves 200-400 cal)
- Soda → Water or unsweet tea (saves 150-300 cal)
```

### Protein-Boosting Tips
```
- Add extra meat/chicken (+20-35g protein)
- Add egg where possible (+6g protein)
- Choose protein-forward options (grilled chicken vs pasta)
- Add beans/legumes (+8-15g protein)
```

## Handling Unknown Restaurants

When restaurant isn't in database:
1. Ask user to describe menu options
2. Use AI to estimate nutrition based on:
   - Similar dishes at known chains
   - Standard portion sizes
   - Cooking method indicators
3. Provide estimates with confidence level
4. Recommend safest choices (grilled proteins, vegetables)

## API Endpoints Required

```
POST /api/v1/restaurant/recommend
GET /api/v1/restaurant/menu/:chain
POST /api/v1/restaurant/estimate-item
GET /api/v1/restaurant/chains
POST /api/v1/restaurant/custom-build
```

## Error Handling

- Unknown restaurant: Offer to estimate or suggest logging meal manually after
- No items fit budget: Suggest smallest reasonable option + adjustment for next meal
- User has dietary restrictions that eliminate all options: Flag clearly with alternatives
