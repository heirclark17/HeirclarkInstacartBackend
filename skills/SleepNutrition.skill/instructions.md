# SleepNutrition Skill

## Purpose
Connect sleep quality data from wearables to nutrition recommendations, helping users understand how sleep affects hunger, cravings, and food choices - and how to compensate on low-sleep days.

## Core Responsibilities

1. **Sleep Analysis** - Interpret sleep data from wearables
2. **Impact Assessment** - Calculate how sleep affects hunger hormones and willpower
3. **Adjusted Recommendations** - Modify nutrition guidance based on sleep quality
4. **Pattern Detection** - Identify food-sleep correlations

## Scientific Foundation

### Sleep and Hunger Hormones
```
Poor Sleep (<6 hours) Effects:
- Ghrelin (hunger hormone): ↑ 15-28%
- Leptin (satiety hormone): ↓ 15-18%
- Cortisol: ↑ 37-45%
- Result: Increased appetite, especially for high-carb/high-fat foods

Practical Impact:
- ~300-400 extra calories consumed on sleep-deprived days
- Cravings for sugary/fatty foods increase 30-45%
- Willpower and food decision-making impaired
```

### Sleep Quality Factors
```
Total Hours: Primary factor
Sleep Efficiency: Time asleep / time in bed
Deep Sleep: Physical recovery
REM Sleep: Mental recovery, mood regulation
Interruptions: Wake-ups disrupt sleep cycles
```

## Sleep Score Calculation

```python
def calculate_sleep_score(sleep_data):
    # Duration score (0-40 points)
    hours = sleep_data.total_hours
    if hours >= 7.5:
        duration_score = 40
    elif hours >= 7:
        duration_score = 35
    elif hours >= 6:
        duration_score = 25
    elif hours >= 5:
        duration_score = 15
    else:
        duration_score = 5

    # Efficiency score (0-25 points)
    efficiency = sleep_data.efficiency_percent
    efficiency_score = min(25, efficiency / 4)

    # Deep sleep score (0-20 points)
    deep_percent = sleep_data.deep_sleep_percent
    if deep_percent >= 20:
        deep_score = 20
    elif deep_percent >= 15:
        deep_score = 15
    elif deep_percent >= 10:
        deep_score = 10
    else:
        deep_score = 5

    # Interruptions penalty (0-15 points)
    wakeups = sleep_data.wake_count
    interruption_score = max(0, 15 - (wakeups * 3))

    return duration_score + efficiency_score + deep_score + interruption_score
```

## Sleep Quality Categories

```
Excellent (85-100): Full 7-8 hours, good efficiency
- No nutrition adjustments needed
- Standard recommendations apply

Good (70-84): 6.5-7 hours, minor interruptions
- Minor vigilance recommended
- Slight protein emphasis to maintain satiety

Fair (50-69): 5.5-6.5 hours or poor efficiency
- Moderate hunger increase expected
- Emphasis on protein and fiber
- Avoid high-carb breakfast

Poor (<50): Under 5.5 hours or very disrupted
- Significant hunger increase expected
- Strategic eating plan for the day
- Caffeine timing important
```

## Response Format

```json
{
  "ok": true,
  "sleep_summary": {
    "last_night": {
      "total_hours": 5.5,
      "efficiency_percent": 78,
      "deep_sleep_percent": 12,
      "rem_sleep_percent": 18,
      "wake_count": 3,
      "bedtime": "23:45",
      "wake_time": "05:30",
      "score": 52,
      "category": "fair",
      "source": "apple_health"
    },
    "weekly_average": {
      "hours": 6.8,
      "score": 71,
      "trend": "declining"
    }
  },
  "nutrition_impact": {
    "hunger_increase_percent": 20,
    "expected_extra_cravings": ["carbs", "sugar", "caffeine"],
    "willpower_status": "reduced",
    "calorie_adjustment": {
      "recommendation": "maintain_target",
      "reason": "Eating more won't fix tiredness and may lead to guilt"
    }
  },
  "todays_strategy": {
    "summary": "Moderate sleep - focus on satiety",
    "recommendations": [
      {
        "category": "breakfast",
        "advice": "Prioritize protein (eggs, Greek yogurt) over carbs (cereal, toast)",
        "why": "Protein prevents mid-morning crash and reduces cravings",
        "avoid": "Sugary breakfast will cause energy spike then crash by 10am"
      },
      {
        "category": "caffeine",
        "advice": "Limit to 200mg (2 cups coffee), stop by 2pm",
        "why": "More caffeine won't help and will hurt tonight's sleep"
      },
      {
        "category": "lunch",
        "advice": "Include fiber-rich vegetables and lean protein",
        "why": "Keeps you full through afternoon slump"
      },
      {
        "category": "snacks",
        "advice": "Prepare protein-rich snacks in advance",
        "why": "When tired, you'll grab whatever's convenient - make it good"
      },
      {
        "category": "dinner",
        "advice": "Eat by 7pm, include complex carbs",
        "why": "Carbs at dinner can actually help sleep tonight"
      },
      {
        "category": "evening",
        "advice": "Avoid eating after 8pm, limit alcohol",
        "why": "Late eating and alcohol further disrupt sleep quality"
      }
    ]
  },
  "sleep_improvement_tips": [
    "Avoid screens 1 hour before bed",
    "Keep bedroom cool (65-68°F)",
    "Consider magnesium supplement with dinner",
    "No caffeine after 2pm"
  ],
  "foods_that_help_sleep": [
    {"food": "Tart cherry juice", "benefit": "Natural melatonin source"},
    {"food": "Almonds", "benefit": "Magnesium for relaxation"},
    {"food": "Fatty fish", "benefit": "Omega-3s and vitamin D"},
    {"food": "Kiwi", "benefit": "Serotonin and antioxidants"},
    {"food": "Chamomile tea", "benefit": "Apigenin promotes drowsiness"}
  ],
  "foods_that_hurt_sleep": [
    {"food": "Caffeine after 2pm", "impact": "Blocks adenosine for 6+ hours"},
    {"food": "Alcohol", "impact": "Disrupts REM sleep"},
    {"food": "Spicy foods at dinner", "impact": "Can cause reflux, raises body temp"},
    {"food": "Large meals before bed", "impact": "Digestive activity disrupts sleep"},
    {"food": "Sugary snacks at night", "impact": "Blood sugar swings cause waking"}
  ]
}
```

## Pattern Detection

### Food → Sleep Correlations
```
Track and report:
- "Days with alcohol correlate with 23% lower sleep score"
- "Large dinners after 8pm reduce deep sleep by 15%"
- "High-sugar days followed by poor sleep 70% of the time"
- "Caffeine after 2pm associated with 30 min less total sleep"
```

### Sleep → Food Correlations
```
Track and report:
- "After poor sleep nights, you consume 350 more calories on average"
- "Low sleep days have 40% more snack entries"
- "Poor sleep correlates with skipped breakfast + overeating at lunch"
```

## API Endpoints Required

```
GET /api/v1/sleep-nutrition/today       - Today's sleep impact + recommendations
GET /api/v1/sleep-nutrition/weekly      - Weekly sleep-nutrition analysis
GET /api/v1/sleep-nutrition/patterns    - Long-term correlations
GET /api/v1/sleep-nutrition/tips        - Personalized improvement tips
POST /api/v1/sleep-nutrition/log-sleep  - Manual sleep entry
```

## Integration Notes

- Primary data source: Apple Health, Fitbit, Oura, Whoop
- Fallback: Allow manual sleep logging
- Sync sleep data by 10am to inform daily recommendations
- Don't be preachy about bad sleep - be helpful and practical
