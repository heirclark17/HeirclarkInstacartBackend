# HabitBuilder Skill

## Purpose
Apply CBT (Cognitive Behavioral Therapy) principles and habit formation science to help users build sustainable nutrition and fitness behaviors through micro-challenges, streak tracking, and trigger identification.

## Core Responsibilities

1. **Habit Tracking** - Monitor consistency of key behaviors
2. **Micro-Challenges** - Provide daily achievable goals
3. **Trigger Analysis** - Identify patterns that derail progress
4. **Streak Management** - Celebrate consistency and recover from breaks
5. **Behavior Coaching** - Apply CBT techniques to overcome obstacles

## Scientific Foundation

### Habit Loop (Charles Duhigg)
```
CUE → ROUTINE → REWARD

Example:
CUE: Alarm goes off at 7am
ROUTINE: Log breakfast within 30 minutes
REWARD: See streak counter increase + positive feedback
```

### Implementation Intentions
```
"When [SITUATION], I will [BEHAVIOR]"

Examples:
- "When I sit down for lunch, I will log my meal first"
- "When I feel snacky at 3pm, I will drink water first"
- "When I order at a restaurant, I will check my remaining macros"
```

### Habit Stacking
```
"After [CURRENT HABIT], I will [NEW HABIT]"

Examples:
- "After I pour my morning coffee, I will log yesterday's weight"
- "After I finish dinner, I will plan tomorrow's meals"
- "After my workout ends, I will log it in the app"
```

## Key Habits to Track

### Tier 1 (Foundation)
```
1. Daily meal logging (any meal)
2. Morning weigh-in
3. Hydration tracking
```

### Tier 2 (Consistency)
```
4. Log all 3 main meals
5. Pre-log meals (before eating)
6. Hit calorie target within 10%
```

### Tier 3 (Optimization)
```
7. Hit protein target daily
8. Log workouts
9. Meal prep weekly
10. Mindful eating (no distracted meals)
```

## Streak System

### Streak Types
```json
{
  "logging_streak": {
    "description": "Consecutive days with at least 1 meal logged",
    "current": 14,
    "longest": 28,
    "milestone_next": 21
  },
  "calorie_target_streak": {
    "description": "Days within 10% of calorie goal",
    "current": 5,
    "longest": 12,
    "milestone_next": 7
  },
  "protein_streak": {
    "description": "Days hitting protein target",
    "current": 3,
    "longest": 8,
    "milestone_next": 7
  },
  "workout_streak": {
    "description": "Days with logged workout",
    "current": 2,
    "longest": 5,
    "milestone_next": 3
  }
}
```

### Streak Recovery
```
If streak breaks:
- Don't reset to zero immediately
- "Grace day" system: 1 miss per week allowed
- Show "streak at risk" warning before full reset
- Celebrate "bounce back" when user returns

Example message:
"You missed logging yesterday - that's okay!
Log a meal today to keep your streak alive.
You're still at 13 days with one grace day used."
```

## Micro-Challenges

### Daily Challenges
```json
{
  "challenge_type": "daily",
  "challenges": [
    {
      "id": "protein_breakfast",
      "title": "Protein-Packed Morning",
      "description": "Include 25g+ protein in your breakfast",
      "difficulty": "medium",
      "xp_reward": 50,
      "tracking": "Check breakfast meal log for protein >= 25"
    },
    {
      "id": "water_first",
      "title": "Water First",
      "description": "Drink 16oz water before your first meal",
      "difficulty": "easy",
      "xp_reward": 25,
      "tracking": "User self-reports"
    },
    {
      "id": "prelog_lunch",
      "title": "Plan Ahead",
      "description": "Log your lunch before you eat it",
      "difficulty": "medium",
      "xp_reward": 50,
      "tracking": "Lunch logged with future timestamp"
    }
  ]
}
```

### Weekly Challenges
```json
{
  "challenge_type": "weekly",
  "challenges": [
    {
      "id": "five_day_logging",
      "title": "Consistent Logger",
      "description": "Log at least one meal for 5 days this week",
      "xp_reward": 200,
      "progress": "3/5 days"
    },
    {
      "id": "meal_prep_sunday",
      "title": "Prep Champion",
      "description": "Complete a meal prep session this weekend",
      "xp_reward": 300,
      "tracking": "User marks prep complete"
    }
  ]
}
```

## Trigger Analysis

### Patterns to Detect
```
Time-Based Triggers:
- "You tend to exceed calories on Fridays and Saturdays"
- "Logging drops off after 7pm"
- "Best adherence is Tuesday-Thursday"

Emotional Triggers:
- "When you don't log for 2+ days, you often overeat the next logged meal"
- "Weekend social events correlate with highest calorie days"

Behavioral Triggers:
- "Days without breakfast logging have 30% higher total calories"
- "When you skip the gym, protein intake drops 25%"
```

### CBT Reframing Responses
```
Trigger: User logged 3000 calories (500 over goal)
Response:
"One day over goal doesn't erase your progress.
Looking at your week, you're still averaging 2050 calories - right on track.
What led to today's higher intake? Understanding the trigger helps prevent it next time."

Trigger: User broke 14-day streak
Response:
"Streaks are tools, not scorecards.
Your consistency over the past month is what matters:
- 26 of 30 days logged (87%)
- Average within 8% of calorie goal
Let's start fresh tomorrow. What one small thing can you commit to?"
```

## Response Format

```json
{
  "ok": true,
  "daily_status": {
    "date": "2025-01-15",
    "habits_completed": 4,
    "habits_total": 6,
    "xp_earned_today": 125,
    "level": 8,
    "xp_to_next_level": 275
  },
  "streaks": {
    "logging": { "current": 14, "status": "active", "milestone_progress": "14/21" },
    "calorie_target": { "current": 5, "status": "active", "milestone_progress": "5/7" },
    "protein": { "current": 0, "status": "broken", "recovery_message": "Hit 150g protein today to start a new streak" }
  },
  "todays_challenge": {
    "id": "veggie_variety",
    "title": "Rainbow Plate",
    "description": "Include 3 different colored vegetables today",
    "xp_reward": 75,
    "why": "Variety ensures you get different micronutrients"
  },
  "habit_insights": [
    {
      "type": "positive",
      "insight": "You've logged breakfast 12 days in a row - this is becoming automatic!"
    },
    {
      "type": "opportunity",
      "insight": "Dinner logging is inconsistent. Try setting a 7pm reminder.",
      "action": {
        "type": "set_reminder",
        "suggested_time": "19:00"
      }
    }
  ],
  "implementation_intention": {
    "focus_area": "protein",
    "statement": "When I open the fridge for a snack, I will grab Greek yogurt or string cheese first",
    "why": "You're averaging 130g protein but your goal is 150g. Protein-rich snacks close this gap."
  }
}
```

## Gamification Elements

### XP System
```
Action                          XP
-----------------------------------
Log a meal                      10
Log all 3 meals                 50 (bonus)
Hit calorie target              25
Hit protein target              25
Complete daily challenge        25-100
Complete weekly challenge       100-500
7-day streak milestone          100
30-day streak milestone         500
Personal best (any metric)      50
```

### Levels
```
Level 1: Starter (0 XP)
Level 5: Consistent (1000 XP)
Level 10: Committed (5000 XP)
Level 15: Dedicated (15000 XP)
Level 20: Master (30000 XP)
Level 25: Legend (50000 XP)
```

## API Endpoints Required

```
GET /api/v1/habits/status           - Daily habit status + streaks
GET /api/v1/habits/streaks          - All streak data
POST /api/v1/habits/check-in        - Mark habit complete
GET /api/v1/habits/challenges       - Get current challenges
POST /api/v1/habits/complete-challenge - Mark challenge done
GET /api/v1/habits/insights         - Pattern analysis
GET /api/v1/habits/xp               - XP and level info
POST /api/v1/habits/implementation-intention - Set/get intentions
```
