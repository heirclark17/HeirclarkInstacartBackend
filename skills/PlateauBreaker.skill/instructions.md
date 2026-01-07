# PlateauBreaker Skill

## Purpose
Detect weight loss/gain plateaus early and provide evidence-based interventions to break through stalls, while distinguishing between true plateaus and normal fluctuations.

## Core Responsibilities

1. **Plateau Detection** - Identify when progress has genuinely stalled
2. **Root Cause Analysis** - Determine why the plateau is occurring
3. **Intervention Strategies** - Provide actionable solutions
4. **Expectation Management** - Educate on normal progress patterns

## Plateau Definition

### True Plateau Criteria
```
Weight Loss Plateau:
- No weight change (±1 lb) for 3+ consecutive weeks
- While maintaining calorie deficit
- With consistent tracking (70%+ days logged)

Weight Gain Plateau (muscle building):
- No weight change for 4+ weeks
- While maintaining calorie surplus
- With consistent strength training

NOT a Plateau:
- Less than 3 weeks of no change
- Inconsistent tracking/adherence
- Weight fluctuating within 2-3 lb range
- Just started a new diet/exercise program
```

### Normal Fluctuation Ranges
```
Daily: ±2-4 lbs (water, food, sodium, hormones)
Weekly: ±1-2 lbs
Monthly: Trending in goal direction

Causes of temporary stalls:
- Menstrual cycle (can mask 2-4 weeks of progress)
- New exercise program (muscle inflammation, water retention)
- Increased sodium intake
- Stress and cortisol
- Sleep deprivation
- Travel/schedule disruption
```

## Plateau Analysis Algorithm

```python
def analyze_plateau(user_data, goal_type):
    weights = user_data.weight_history[-28:]  # Last 4 weeks

    # Calculate trend
    week1_avg = average(weights[0:7])
    week4_avg = average(weights[21:28])
    change = week4_avg - week1_avg

    # Check adherence
    days_logged = user_data.days_logged_last_28
    adherence_pct = days_logged / 28 * 100

    # Determine plateau status
    if goal_type == 'weight_loss':
        if change > -0.5 and adherence_pct >= 70:
            if weeks_stalled >= 3:
                return 'confirmed_plateau'
            elif weeks_stalled >= 2:
                return 'potential_plateau'
            else:
                return 'monitoring'
        elif adherence_pct < 70:
            return 'adherence_issue'
        else:
            return 'progressing'

    # Analyze contributing factors
    factors = []
    if user_data.avg_calories > user_data.target_calories * 0.95:
        factors.append('calories_too_high')
    if user_data.avg_protein < user_data.target_protein * 0.8:
        factors.append('protein_low')
    if user_data.exercise_frequency < 2:
        factors.append('low_activity')
    if user_data.avg_sleep_hours < 6:
        factors.append('poor_sleep')
    if user_data.stress_indicators:
        factors.append('high_stress')

    return {
        'status': plateau_status,
        'contributing_factors': factors,
        'confidence': calculate_confidence(data_quality)
    }
```

## Response Format

```json
{
  "ok": true,
  "plateau_analysis": {
    "status": "confirmed_plateau",
    "weeks_stalled": 4,
    "weight_trend": {
      "4_weeks_ago": 185.2,
      "current": 184.8,
      "change": -0.4,
      "expected_if_progressing": -4.0
    },
    "confidence": 85,
    "data_quality": "good"
  },
  "adherence_check": {
    "logging_consistency": 82,
    "calorie_adherence": 78,
    "protein_adherence": 65,
    "verdict": "Logging is good, but protein is consistently under target"
  },
  "root_cause_analysis": {
    "primary_factors": [
      {
        "factor": "Metabolic Adaptation",
        "likelihood": "high",
        "explanation": "After 12 weeks of dieting, your metabolism has slowed by an estimated 10-15%",
        "evidence": "Calorie intake that created deficit initially no longer does"
      },
      {
        "factor": "Low Protein Intake",
        "likelihood": "high",
        "explanation": "Averaging 110g vs 150g target. Low protein accelerates muscle loss and metabolic slowdown",
        "evidence": "Protein logged below target 75% of days"
      }
    ],
    "secondary_factors": [
      {
        "factor": "Reduced NEAT",
        "likelihood": "medium",
        "explanation": "Non-exercise activity tends to decrease unconsciously during dieting",
        "evidence": "Average steps dropped from 8500 to 6200 over past 6 weeks"
      }
    ],
    "ruled_out": [
      {
        "factor": "Tracking Inaccuracy",
        "reason": "Consistent logging, reasonable portions reported"
      }
    ]
  },
  "interventions": {
    "recommended_strategy": "diet_break",
    "options": [
      {
        "strategy": "Diet Break (Recommended)",
        "description": "Eat at maintenance calories for 1-2 weeks",
        "implementation": {
          "new_calorie_target": 2200,
          "duration": "10-14 days",
          "keep_protein_high": true,
          "maintain_exercise": true
        },
        "expected_outcome": "Weight may increase 1-3 lbs (water), then resume loss when deficit resumes",
        "why_it_works": "Restores leptin levels, reduces cortisol, gives psychological break"
      },
      {
        "strategy": "Refeed Days",
        "description": "2 high-carb days per week at maintenance",
        "implementation": {
          "refeed_days": ["Wednesday", "Saturday"],
          "refeed_calories": 2200,
          "extra_carbs": "+100g from fruit, rice, potatoes",
          "other_days": "Continue current deficit"
        },
        "expected_outcome": "Boost metabolism while maintaining weekly deficit",
        "why_it_works": "Carbs upregulate thyroid and leptin without full diet break"
      },
      {
        "strategy": "Calorie Cycling",
        "description": "Alternate higher and lower calorie days",
        "implementation": {
          "high_days": [1800, "workout days"],
          "low_days": [1400, "rest days"],
          "weekly_average": 1600
        },
        "expected_outcome": "Same weekly deficit but may break adaptation",
        "why_it_works": "Metabolic confusion, prevents full adaptation"
      },
      {
        "strategy": "Increase Activity",
        "description": "Add 2000 steps daily instead of cutting more calories",
        "implementation": {
          "current_steps": 6200,
          "target_steps": 8500,
          "method": "Morning and evening walks"
        },
        "expected_outcome": "~150 extra calories burned daily without increasing hunger",
        "why_it_works": "Creates deficit without metabolic adaptation from food restriction"
      }
    ],
    "NOT_recommended": [
      {
        "strategy": "Cut Calories Further",
        "reason": "Already at 1500 cal - going lower risks muscle loss, nutrient deficiency, and further metabolic adaptation"
      },
      {
        "strategy": "Excessive Cardio",
        "reason": "Can increase cortisol and hunger, leading to compensatory eating"
      }
    ]
  },
  "action_plan": {
    "immediate": [
      "Increase protein to 150g minimum daily",
      "Add 10-minute walk after each meal"
    ],
    "this_week": [
      "Implement diet break at 2200 calories",
      "Focus on sleep quality (target 7+ hours)"
    ],
    "monitor": [
      "Weight daily, but focus on weekly average",
      "Track energy levels (should improve during diet break)"
    ],
    "reassess": "After 2 weeks, resume 1600 calorie target and monitor for 3 weeks"
  },
  "expectation_setting": {
    "realistic_timeline": "Expect 2-4 weeks before seeing scale movement resume",
    "non_scale_victories": [
      "Measurements (waist, hips) may still decrease even if scale doesn't",
      "Energy levels should improve",
      "Strength should maintain or increase"
    ],
    "when_to_seek_help": "If no progress after 8 weeks of consistent effort, consider consulting a doctor to rule out thyroid or hormonal issues"
  }
}
```

## Intervention Strategies

### Diet Break Protocol
```
When to use: After 8-12+ weeks of continuous dieting
Duration: 7-14 days
Calories: Maintenance (TDEE)
Protein: Keep at 0.8-1g/lb
Exercise: Maintain current routine

Expected outcomes:
- Water weight increase of 2-5 lbs (normal, mostly glycogen)
- Hunger reduction
- Energy improvement
- Hormone normalization
- Mental refresh
```

### Refeed Protocol
```
When to use: Mild plateau, don't want full diet break
Frequency: 1-2 days per week
Calories: Maintenance or slight surplus
Focus: Extra calories from carbs
Protein: Maintain target
Fat: Reduce slightly to accommodate carbs

Expected outcomes:
- Temporary water weight spike (1-2 lbs)
- Improved workout performance
- Better sleep
- Mood improvement
```

### Reverse Diet Protocol
```
When to use: Very low calorie dieting has stalled
Method: Increase calories by 50-100 per week
Duration: 4-8 weeks to reach maintenance
Goal: Rebuild metabolism before resuming deficit

Expected outcomes:
- Slow weight stabilization (not loss)
- Improved energy and performance
- Restored metabolic rate
- Better position for future fat loss
```

## API Endpoints Required

```
GET /api/v1/plateau/status              - Current plateau status
GET /api/v1/plateau/analysis            - Full root cause analysis
POST /api/v1/plateau/intervention       - Start an intervention
GET /api/v1/plateau/intervention-status - Track intervention progress
GET /api/v1/plateau/history             - Past plateaus and resolutions
```

## Important Guidelines

- Never recommend going below 1200 cal (women) or 1500 cal (men)
- Always check adherence before assuming true plateau
- Educate that plateaus are normal and temporary
- Frame interventions positively (not as failure)
- Consider referring to healthcare provider if plateau persists 8+ weeks
