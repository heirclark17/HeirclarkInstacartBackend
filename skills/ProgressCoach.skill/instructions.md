# ProgressCoach Skill

## Purpose
Analyze user's nutrition and fitness trends to provide personalized, actionable coaching feedback that keeps users motivated and on track toward their goals.

## Core Responsibilities

1. **Trend Analysis** - Examine weight, nutrition, and activity patterns over time
2. **Goal Progress** - Calculate and communicate progress toward user's stated goals
3. **Pattern Recognition** - Identify positive habits and areas needing improvement
4. **Motivational Feedback** - Provide encouraging, specific, actionable guidance

## Data Sources

- `GET /api/v1/user/goals` - User's calorie/macro/weight targets
- `GET /api/v1/weight/history` - Weight tracking data
- `GET /api/v1/nutrition/history` - Daily nutrition summaries
- `GET /api/v1/health-data/activity` - Wearable activity data
- `GET /api/v1/nutrition/meals` - Meal logging history

## Analysis Rules

### Weight Trend Analysis
```
- Calculate 7-day rolling average to smooth daily fluctuations
- Compare current week vs previous week vs month ago
- Safe weight loss: 0.5-1% body weight per week
- Safe weight gain: 0.25-0.5% body weight per week
- Plateau defined as: <1 lb change over 3+ weeks
```

### Nutrition Adherence Scoring
```
adherence_score = (
  (days_logged / total_days) * 0.3 +
  (days_within_calorie_target / days_logged) * 0.4 +
  (days_protein_target_met / days_logged) * 0.3
) * 100

Excellent: 85-100%
Good: 70-84%
Needs Work: 50-69%
At Risk: <50%
```

### Consistency Patterns
```
Track:
- Logging streaks (consecutive days)
- Time-of-day logging patterns
- Weekday vs weekend adherence
- Meal type coverage (breakfast/lunch/dinner)
```

## Response Templates

### Weekly Summary
```json
{
  "period": "week",
  "weight_change_lbs": -1.2,
  "avg_daily_calories": 1850,
  "calorie_target": 2000,
  "adherence_score": 82,
  "protein_avg_g": 145,
  "protein_target_g": 150,
  "logging_streak_days": 12,
  "insights": [
    {
      "type": "positive",
      "message": "You've logged every day for 12 days straight!",
      "impact": "Consistency is the #1 predictor of success"
    },
    {
      "type": "observation",
      "message": "Weekend calories average 400 higher than weekdays",
      "suggestion": "Try pre-logging Saturday meals in the morning"
    }
  ],
  "next_week_focus": "Hit protein target 5/7 days"
}
```

### Milestone Celebrations
```
- First week logged: "You've completed your first full week!"
- 10 lb milestone: "10 lbs down! That's [X]% of your goal!"
- 30-day streak: "One month of consistency - you're building real habits"
- Goal reached: "GOAL ACHIEVED! You've reached [target]!"
```

## Coaching Tone Guidelines

1. **Be specific** - "Your protein was 35g under on Tuesday and Thursday" not "Eat more protein"
2. **Be encouraging** - Lead with wins before areas for improvement
3. **Be actionable** - Every observation should have a concrete next step
4. **Be honest** - Don't sugarcoat plateaus or declining adherence
5. **Be personal** - Reference their specific data and history

## Warning Triggers

Alert user and suggest professional consultation if:
- Weight loss exceeds 3 lbs/week consistently
- Calorie intake below 1200 (women) or 1500 (men) for extended periods
- Signs of disordered eating patterns
- No progress despite perfect adherence (may indicate medical issue)

## API Endpoints Required

```
POST /api/v1/coach/weekly-summary
POST /api/v1/coach/analyze-trends
GET /api/v1/coach/insights?days=30
GET /api/v1/coach/milestones
POST /api/v1/coach/focus-recommendation
```
