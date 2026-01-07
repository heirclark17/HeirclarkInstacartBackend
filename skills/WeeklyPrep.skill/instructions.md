# WeeklyPrep Skill

## Purpose
Optimize meal preparation by generating batch cooking plans that maximize efficiency, minimize time in the kitchen, and ensure meals stay fresh throughout the week.

## Core Responsibilities

1. **Batch Analysis** - Identify which meals share common components
2. **Prep Scheduling** - Create optimal prep day schedule
3. **Storage Guidance** - Advise on storage methods and shelf life
4. **Efficiency Optimization** - Minimize total cooking time through smart batching

## Data Sources

- `GET /api/v1/ai/meal-plan` - User's 7-day meal plan
- `GET /api/v1/preferences` - Cooking skill level, available equipment
- `GET /api/v1/user/goals` - Nutrition targets for portioning

## Batch Cooking Principles

### Protein Batching
```
Chicken Breast:
- Prep: Season all at once
- Cook: Bake sheet pan @ 400°F, 20-25 min
- Variations: Plain, Italian herb, Cajun, Teriyaki
- Storage: Refrigerator 4 days, Freezer 3 months
- Reheat: Microwave 2 min or slice cold for salads

Ground Turkey/Beef:
- Prep: Brown in large batches
- Cook: 10-12 min per pound
- Variations: Taco seasoned, Italian, Plain
- Storage: Refrigerator 3-4 days, Freezer 3 months
- Reheat: Microwave or pan with splash of water

Salmon/Fish:
- Prep: Best cooked fresh or within 2 days
- Cook: Bake @ 400°F, 12-15 min
- Storage: Refrigerator 2 days only
- Note: Don't batch more than 2-3 days ahead
```

### Grain Batching
```
Brown Rice:
- Batch size: 4-6 cups dry (makes 12-18 cups cooked)
- Cook: Rice cooker or Instant Pot
- Storage: Refrigerator 5-6 days, Freezer 6 months
- Reheat: Microwave with 1 tbsp water per cup

Quinoa:
- Batch size: 3-4 cups dry
- Cook: 15-20 min stovetop
- Storage: Refrigerator 5-7 days
- Reheat: Microwave or serve cold in salads

Sweet Potatoes:
- Batch size: 4-6 medium
- Cook: Bake @ 400°F, 45-60 min
- Storage: Refrigerator 5-7 days
- Reheat: Microwave 2-3 min
```

### Vegetable Batching
```
Roasted Vegetables (broccoli, Brussels, cauliflower):
- Prep: Cut to uniform size
- Cook: 400°F, 20-25 min
- Storage: Refrigerator 4-5 days
- Note: Slightly undercook for reheating

Raw Prep (bell peppers, onions, carrots):
- Prep: Wash, cut, store in containers
- Storage: Refrigerator 5-7 days
- Use: Stir-fries, salads, snacking

Leafy Greens:
- Prep: Wash, dry thoroughly, store with paper towel
- Storage: Refrigerator 5-7 days
- Note: Don't dress until serving
```

## Prep Day Schedule Template

```json
{
  "prep_day": "Sunday",
  "total_time_estimate_mins": 120,
  "schedule": [
    {
      "time": "0:00",
      "action": "Preheat oven to 400°F",
      "duration_mins": 0,
      "passive": true
    },
    {
      "time": "0:00",
      "action": "Start rice cooker with 4 cups brown rice",
      "duration_mins": 5,
      "passive": false
    },
    {
      "time": "0:05",
      "action": "Season chicken breasts (2 lbs) - divide into 3 flavor profiles",
      "duration_mins": 10,
      "passive": false
    },
    {
      "time": "0:15",
      "action": "Put chicken in oven",
      "duration_mins": 2,
      "passive": false
    },
    {
      "time": "0:17",
      "action": "Chop vegetables for roasting (broccoli, bell peppers)",
      "duration_mins": 15,
      "passive": false
    },
    {
      "time": "0:32",
      "action": "Toss vegetables with oil and seasoning",
      "duration_mins": 5,
      "passive": false
    },
    {
      "time": "0:37",
      "action": "Check chicken, start timer for vegetables",
      "duration_mins": 3,
      "passive": false
    },
    {
      "time": "0:40",
      "action": "Prep raw vegetables for snacking (carrots, celery)",
      "duration_mins": 10,
      "passive": false
    },
    {
      "time": "0:50",
      "action": "Remove chicken, let rest. Put vegetables in oven",
      "duration_mins": 5,
      "passive": false
    },
    {
      "time": "0:55",
      "action": "Portion and store chicken in containers",
      "duration_mins": 10,
      "passive": false
    },
    {
      "time": "1:05",
      "action": "Check rice - fluff and let cool",
      "duration_mins": 5,
      "passive": false
    },
    {
      "time": "1:10",
      "action": "Remove vegetables, let cool",
      "duration_mins": 5,
      "passive": false
    },
    {
      "time": "1:15",
      "action": "Portion rice and vegetables into meal containers",
      "duration_mins": 15,
      "passive": false
    },
    {
      "time": "1:30",
      "action": "Clean up kitchen",
      "duration_mins": 15,
      "passive": false
    }
  ],
  "containers_needed": {
    "meal_prep_containers": 10,
    "snack_containers": 5,
    "large_storage": 2
  }
}
```

## Response Format

```json
{
  "ok": true,
  "meal_plan_analyzed": {
    "total_meals": 21,
    "unique_proteins": 3,
    "unique_grains": 2,
    "batch_opportunities": 8
  },
  "prep_plan": {
    "recommended_prep_day": "Sunday",
    "total_active_time_mins": 90,
    "total_passive_time_mins": 45,
    "batches": [
      {
        "category": "protein",
        "item": "Chicken breast",
        "amount": "3 lbs",
        "covers_meals": ["Mon lunch", "Tue dinner", "Wed lunch", "Thu dinner"],
        "prep_instructions": "Season with Italian herbs, bake at 400°F for 22 min",
        "storage": "Glass containers, refrigerator",
        "stays_fresh_days": 4
      },
      {
        "category": "grain",
        "item": "Brown rice",
        "amount": "4 cups dry",
        "covers_meals": ["Mon-Fri lunches and dinners"],
        "prep_instructions": "Rice cooker, 1:1.5 ratio water",
        "storage": "Large container, refrigerator",
        "stays_fresh_days": 6
      }
    ],
    "schedule": [...],
    "day_of_eating_assembly": [
      {
        "meal": "Monday Lunch",
        "assembly_time_mins": 3,
        "steps": [
          "Grab prepped chicken container",
          "Scoop 1 cup rice",
          "Add roasted broccoli",
          "Microwave 2 minutes"
        ]
      }
    ]
  },
  "shopping_list": {
    "for_prep_day": [
      {"item": "Chicken breast", "amount": "3 lbs"},
      {"item": "Brown rice", "amount": "4 cups"},
      {"item": "Broccoli", "amount": "2 heads"}
    ],
    "buy_fresh_midweek": [
      {"item": "Salad greens", "reason": "Best fresh, buy Wednesday"},
      {"item": "Fish for Friday", "reason": "Don't batch, cook fresh"}
    ]
  },
  "equipment_needed": [
    "Sheet pans (2)",
    "Rice cooker or Instant Pot",
    "Meal prep containers (10-12)",
    "Large mixing bowls"
  ],
  "tips": [
    "Let all food cool completely before refrigerating",
    "Label containers with contents and date",
    "Store sauces separately to prevent soggy food"
  ]
}
```

## Freshness Rules

```
Refrigerator Life:
- Cooked chicken: 3-4 days
- Cooked beef: 3-4 days
- Cooked fish: 1-2 days
- Cooked grains: 5-6 days
- Roasted vegetables: 4-5 days
- Raw cut vegetables: 5-7 days
- Dressed salads: Same day only

Freezer Friendly:
- Cooked proteins (except fish): 2-3 months
- Cooked grains: 6 months
- Soups and stews: 3 months
- Breakfast burritos: 3 months

Not Freezer Friendly:
- Salads and raw vegetables
- Egg-based dishes (get rubbery)
- Cream-based sauces
- Fried foods (get soggy)
```

## API Endpoints Required

```
POST /api/v1/weekly-prep/generate    - Generate prep plan from meal plan
GET /api/v1/weekly-prep/schedule     - Get prep day schedule
POST /api/v1/weekly-prep/customize   - Adjust prep plan
GET /api/v1/weekly-prep/shopping     - Get prep day shopping list
GET /api/v1/weekly-prep/storage-tips - Storage guidance for specific items
```
