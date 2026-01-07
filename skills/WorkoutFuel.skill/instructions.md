# WorkoutFuel Skill

## Purpose
Dynamically adjust nutrition recommendations based on user's workout activity, ensuring they fuel properly for performance and recovery while staying aligned with their goals.

## Core Responsibilities

1. **Activity Detection** - Sync and interpret workout data from wearables
2. **Calorie Adjustment** - Calculate additional calories burned and adjust daily target
3. **Timing Recommendations** - Advise on pre/post workout nutrition timing
4. **Macro Optimization** - Adjust macro ratios based on workout type

## Data Sources

- `GET /api/v1/health-data/activity` - Steps, active minutes
- `GET /api/v1/health-data/workouts` - Workout sessions
- `GET /api/v1/wearables/apple/today` - Apple Health data
- `GET /api/v1/integrations/fitbit/today` - Fitbit data
- `GET /api/v1/user/goals` - Base nutrition targets
- `GET /api/v1/nutrition/day-summary` - Current consumption

## Workout Classification

### By Type
```
Strength Training:
- Calorie multiplier: 5-8 cal/minute
- Post-workout priority: Protein (0.3-0.4g/lb body weight)
- Carb timing: Within 2 hours post-workout

Cardio (Moderate):
- Calorie multiplier: 8-12 cal/minute
- Post-workout priority: Carbs + Protein (3:1 ratio)
- Hydration: 16-24 oz per hour of activity

Cardio (High Intensity/HIIT):
- Calorie multiplier: 12-16 cal/minute
- Post-workout priority: Fast carbs + Protein
- Recovery window: 30-60 minutes

Yoga/Flexibility:
- Calorie multiplier: 3-5 cal/minute
- Post-workout priority: Hydration
- No significant macro adjustment needed

Mixed/CrossFit:
- Calorie multiplier: 10-14 cal/minute
- Post-workout priority: Protein + Carbs (1:1 ratio)
- Consider electrolyte replacement
```

### By Intensity
```
Low (Zone 1-2): 50-60% max HR
- Minimal calorie adjustment
- Focus on hydration

Moderate (Zone 3): 60-70% max HR
- Add 80% of estimated burn to daily target
- Standard post-workout nutrition

High (Zone 4-5): 70-90% max HR
- Add 100% of estimated burn to daily target
- Prioritize recovery nutrition
- Consider rest day nutrition boost
```

## Adjustment Calculation

```python
def calculate_workout_adjustment(workout, user_profile):
    # Base burn from activity
    base_burn = workout.duration_mins * get_multiplier(workout.type, workout.intensity)

    # Adjust for body weight (heavier = more burn)
    weight_factor = user_profile.weight_lbs / 150  # Normalized to 150 lbs

    # Adjust for fitness level (fitter = more efficient = less burn)
    fitness_factor = 1.0 - (user_profile.fitness_level * 0.1)  # 0-10 scale

    estimated_burn = base_burn * weight_factor * fitness_factor

    # Calculate macro adjustments
    if workout.type in ['strength', 'crossfit']:
        protein_boost = workout.duration_mins * 0.5  # Extra grams
        carb_boost = estimated_burn * 0.3 / 4  # 30% of extra cals as carbs
    elif workout.type in ['cardio', 'hiit']:
        protein_boost = workout.duration_mins * 0.3
        carb_boost = estimated_burn * 0.5 / 4  # 50% of extra cals as carbs
    else:
        protein_boost = 0
        carb_boost = 0

    return {
        'calories_burned': round(estimated_burn),
        'additional_calories': round(estimated_burn * 0.8),  # Eat back 80%
        'protein_boost_g': round(protein_boost),
        'carb_boost_g': round(carb_boost)
    }
```

## Response Format

```json
{
  "ok": true,
  "today_activity": {
    "workouts": [
      {
        "type": "strength_training",
        "duration_mins": 45,
        "intensity": "moderate",
        "time": "07:30",
        "estimated_burn": 340
      }
    ],
    "steps": 8500,
    "active_minutes": 62,
    "total_estimated_burn": 580
  },
  "adjustments": {
    "base_calorie_target": 2000,
    "activity_addition": 460,
    "adjusted_calorie_target": 2460,
    "base_protein_target": 150,
    "protein_boost": 22,
    "adjusted_protein_target": 172,
    "explanation": "Your 45-minute strength session burned ~340 calories. Adding 460 to your daily target to support recovery and muscle building."
  },
  "timing_recommendations": [
    {
      "window": "now",
      "recommendation": "Post-workout window open for 2 more hours",
      "suggested_meal": {
        "description": "Protein shake with banana",
        "calories": 350,
        "protein": 35,
        "carbs": 40,
        "fat": 5
      },
      "why": "Fast-absorbing protein + carbs maximize muscle protein synthesis"
    }
  ],
  "remaining_for_day": {
    "calories": 1650,
    "protein": 95,
    "carbs": 180,
    "fat": 55
  },
  "hydration_reminder": {
    "target_oz": 100,
    "consumed_oz": 48,
    "remaining_oz": 52,
    "message": "You've worked out today - aim to finish at least 52 more oz of water"
  }
}
```

## Pre-Workout Recommendations

### Timing
```
2-3 hours before: Full meal (400-600 cal)
1-2 hours before: Light meal/snack (200-300 cal)
30-60 mins before: Quick energy (100-150 cal)
```

### By Workout Type
```
Strength Training:
- Moderate carbs + protein
- Example: Greek yogurt with berries, banana with almond butter

Cardio:
- Higher carbs, lower fat (faster digestion)
- Example: Oatmeal with honey, toast with jam

HIIT:
- Quick carbs, minimal fat/fiber
- Example: Banana, sports drink, rice cakes
```

## Post-Workout Recommendations

### Timing Windows
```
Immediate (0-30 min): Protein shake, chocolate milk
Short-term (30-60 min): Balanced meal with protein focus
Extended (1-2 hours): Full meal, prioritize whole foods
```

### Recovery Priorities
```
1. Protein: 20-40g for muscle repair
2. Carbs: Replenish glycogen stores
3. Hydration: Replace fluids lost
4. Electrolytes: If workout > 60 mins or heavy sweating
```

## API Endpoints Required

```
GET /api/v1/workout-fuel/today          - Today's activity + adjustments
POST /api/v1/workout-fuel/log-workout   - Manual workout entry
GET /api/v1/workout-fuel/pre-workout    - Pre-workout meal suggestions
GET /api/v1/workout-fuel/post-workout   - Post-workout meal suggestions
GET /api/v1/workout-fuel/weekly-summary - Activity patterns + nutrition sync
```

## Integration Notes

- Sync with Apple Health every 15 minutes when app is active
- Sync with Fitbit every 30 minutes
- Allow manual workout entry for gym sessions not tracked
- Respect user preference for "eat back" percentage (some prefer 50%, others 100%)
