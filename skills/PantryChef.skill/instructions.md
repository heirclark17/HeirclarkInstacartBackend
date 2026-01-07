# PantryChef Skill

## Purpose
Generate recipes and meal suggestions using ingredients the user already has at home, reducing food waste and eliminating the "what's for dinner" decision fatigue.

## Core Responsibilities

1. **Ingredient Matching** - Find recipes that maximize use of available ingredients
2. **Smart Substitutions** - Suggest swaps when missing minor ingredients
3. **Nutrition Optimization** - Ensure suggestions fit user's macro targets
4. **Shopping Gap Fill** - Identify minimal items needed to unlock more recipes

## Data Sources

- `POST /api/v1/pantry/items` - User's pantry inventory
- `GET /api/v1/user/goals` - Macro targets
- `GET /api/v1/preferences` - Dietary restrictions
- `GET /api/v1/nutrition/day-summary` - Remaining daily budget
- Internal recipe database

## Pantry Management

### Adding Items
```json
{
  "action": "add",
  "items": [
    { "name": "chicken breast", "quantity": 2, "unit": "lbs", "category": "protein" },
    { "name": "brown rice", "quantity": 1, "unit": "bag", "category": "grain" },
    { "name": "broccoli", "quantity": 1, "unit": "head", "category": "vegetable" }
  ]
}
```

### Categories
- **Proteins**: chicken, beef, pork, fish, tofu, eggs, beans
- **Grains**: rice, pasta, quinoa, bread, oats
- **Vegetables**: fresh, frozen, canned
- **Fruits**: fresh, frozen, dried
- **Dairy**: milk, cheese, yogurt, butter
- **Pantry Staples**: oils, spices, sauces, condiments
- **Frozen**: proteins, vegetables, prepared items

## Recipe Matching Algorithm

```python
def find_recipes(pantry_items, user_goals, preferences):
    all_recipes = get_recipe_database()

    for recipe in all_recipes:
        # Calculate ingredient match score
        have = set(pantry_items)
        need = set(recipe.ingredients)
        match_pct = len(have & need) / len(need) * 100

        # Calculate nutrition fit
        nutrition_fit = score_nutrition_fit(recipe.macros, user_goals)

        # Check dietary compliance
        dietary_ok = check_restrictions(recipe, preferences)

        recipe.score = (match_pct * 0.5) + (nutrition_fit * 0.3) + (dietary_ok * 0.2)

    return sorted(all_recipes, by=score, desc=True)
```

## Match Thresholds

- **Perfect Match (100%)**: All ingredients available
- **Almost There (80-99%)**: Missing 1-2 minor ingredients
- **Partial Match (60-79%)**: Missing 2-3 ingredients, offer shopping addition
- **Inspiration Only (<60%)**: Show recipe but clearly indicate shopping needed

## Response Format

```json
{
  "ok": true,
  "pantry_items_used": 8,
  "recipes": [
    {
      "match_type": "perfect",
      "match_pct": 100,
      "name": "Garlic Chicken Stir-Fry with Brown Rice",
      "description": "Quick weeknight dinner ready in 25 minutes",
      "prep_time_mins": 10,
      "cook_time_mins": 15,
      "servings": 2,
      "nutrition_per_serving": {
        "calories": 450,
        "protein": 38,
        "carbs": 42,
        "fat": 14
      },
      "ingredients_from_pantry": [
        "1 lb chicken breast, sliced",
        "1 cup brown rice",
        "2 cups broccoli florets",
        "3 cloves garlic, minced",
        "2 tbsp soy sauce",
        "1 tbsp olive oil"
      ],
      "ingredients_assumed": [
        "Salt and pepper (pantry staple)"
      ],
      "instructions": [
        "Cook brown rice according to package directions",
        "Slice chicken into thin strips, season with salt and pepper",
        "Heat olive oil in large skillet over medium-high heat",
        "Cook chicken 5-6 minutes until golden, set aside",
        "Add broccoli and garlic, stir-fry 3-4 minutes",
        "Return chicken, add soy sauce, toss to combine",
        "Serve over rice"
      ],
      "tips": [
        "Add red pepper flakes for heat",
        "Squeeze of lime at the end brightens flavors"
      ],
      "fits_remaining_budget": true
    }
  ],
  "shopping_suggestions": {
    "unlock_5_more_recipes": [
      { "item": "sesame oil", "cost_estimate": "$4" },
      { "item": "ginger root", "cost_estimate": "$2" }
    ],
    "instacart_link": "https://instacart.com/..."
  }
}
```

## Substitution Intelligence

### Common Swaps
```
Ingredient        → Substitution
-------------------------------------------
Chicken breast    → Chicken thigh, turkey, tofu
Brown rice        → White rice, quinoa, cauliflower rice
Soy sauce         → Coconut aminos, tamari
Butter            → Olive oil, coconut oil
Heavy cream       → Greek yogurt, coconut cream
Breadcrumbs       → Crushed crackers, oats, almond flour
Fresh herbs       → Dried herbs (1/3 the amount)
Lemon juice       → Lime juice, vinegar
```

### Swap Rules
- Always note substitution affects on taste/texture
- Flag if substitution changes nutrition significantly
- Respect dietary restrictions (no dairy swap for dairy-free user)

## Pantry Staples Assumption

Assume user has these unless told otherwise:
- Salt, pepper, basic spices
- Cooking oil (olive or vegetable)
- Garlic, onions
- Basic condiments (ketchup, mustard, mayo)

## API Endpoints Required

```
POST /api/v1/pantry/items          - Add/update pantry items
GET /api/v1/pantry/items           - Get current pantry
DELETE /api/v1/pantry/items/:id    - Remove item
POST /api/v1/pantry/recipes        - Get recipes from pantry
POST /api/v1/pantry/what-can-i-make - Quick recipe suggestions
GET /api/v1/pantry/shopping-suggestions - What to buy next
```
