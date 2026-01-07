# MealPersonalizer Skill

## Purpose
Generate personalized weekly meal plans using user nutrition goals, dietary preferences, workout history, and database meal history. Integrates with Instacart for shopping list generation.

## Instructions

When generating a meal plan, follow this process:

### 1. Gather User Context
- Query PostgreSQL for user's nutrition goals (daily calories, protein, carbs, fat targets)
- Retrieve dietary preferences (vegetarian, keto, allergies, etc.)
- Fetch workout schedule via FitnessCoach MCP
- Analyze past meal history for preferences and variety

### 2. Calculate Daily Requirements
- Base calories from user goals
- Adjust for workout days (+200-500 cal on heavy workout days)
- Protein timing: Higher protein meals post-workout
- Macro distribution based on goal type (cut/bulk/maintain)

### 3. Generate 7-Day Plan
For each day, create:
- **Breakfast** (25% daily calories)
- **Lunch** (35% daily calories)
- **Dinner** (30% daily calories)
- **Snacks** (10% daily calories)

Ensure:
- Variety: Don't repeat same meal within 3 days
- Balance: Hit macro targets within 5% daily
- Practicality: Consider prep time, cooking skill level
- Cost: Optimize for budget when specified

### 4. Validate Nutrition
Use NutritionValidator skill to verify all food items against USDA data before including in plan.

### 5. Generate Instacart List
- Aggregate all ingredients needed
- Group by store section (produce, dairy, meat, etc.)
- Calculate quantities based on serving sizes
- Generate Instacart deep links for easy ordering

## Response Format

```json
{
  "user_id": string,
  "week_start": "YYYY-MM-DD",
  "goals_summary": {
    "daily_calories": number,
    "protein_g": number,
    "carbs_g": number,
    "fat_g": number,
    "goal_type": "cut" | "bulk" | "maintain"
  },
  "workout_sync": {
    "synced": boolean,
    "workout_days": string[],
    "rest_days": string[]
  },
  "meal_plan": [
    {
      "day": "Monday",
      "date": "YYYY-MM-DD",
      "is_workout_day": boolean,
      "adjusted_calories": number,
      "meals": {
        "breakfast": MealObject,
        "lunch": MealObject,
        "dinner": MealObject,
        "snacks": MealObject[]
      },
      "daily_totals": {
        "calories": number,
        "protein_g": number,
        "carbs_g": number,
        "fat_g": number
      }
    }
  ],
  "grocery_list": {
    "items": GroceryItem[],
    "estimated_cost": number,
    "instacart_link": string
  },
  "prep_tips": string[]
}
```

### MealObject Schema
```json
{
  "name": string,
  "ingredients": [
    {
      "food_name": string,
      "amount": number,
      "unit": string,
      "calories": number,
      "protein_g": number,
      "carbs_g": number,
      "fat_g": number,
      "usda_validated": boolean
    }
  ],
  "total_nutrition": {
    "calories": number,
    "protein_g": number,
    "carbs_g": number,
    "fat_g": number
  },
  "prep_time_min": number,
  "cook_time_min": number,
  "recipe_url": string | null
}
```

## Dietary Preference Handling

| Preference | Rules |
|------------|-------|
| Vegetarian | No meat, fish allowed |
| Vegan | No animal products |
| Keto | <20g net carbs/day, high fat |
| Low-carb | <100g carbs/day |
| High-protein | >1g protein per lb bodyweight |
| Gluten-free | Exclude wheat, barley, rye |
| Dairy-free | No milk, cheese, yogurt |
| Nut-free | Exclude all tree nuts, peanuts |

## Workout Day Adjustments

- **Rest day**: Base calories
- **Light cardio** (30 min): +150 cal
- **Moderate workout** (45-60 min): +300 cal
- **Heavy lifting/HIIT**: +400-500 cal
- **Post-workout meal**: +15g protein, prefer fast-digesting carbs

## Error Handling

- If user goals not set, prompt to complete onboarding
- If FitnessCoach MCP unavailable, generate plan without workout sync
- If Instacart unavailable, provide generic grocery list
