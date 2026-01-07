# SocialAccountability Skill

## Purpose
Leverage social connections and friendly competition to boost motivation, accountability, and long-term adherence through friend challenges, group goals, and celebration of shared achievements.

## Core Responsibilities

1. **Friend Connections** - Enable users to connect and support each other
2. **Challenges** - Create and manage friendly competitions
3. **Leaderboards** - Rank participants on various metrics
4. **Celebrations** - Recognize and share achievements
5. **Accountability Partners** - Match users for mutual support

## Privacy Framework

### Shareable Data (Opt-in per item)
```
- Streak count (e.g., "14-day logging streak")
- Goal progress percentage (e.g., "75% to goal weight")
- Achievement badges earned
- Challenge participation and ranking
- Weekly adherence score
- Milestone celebrations

Users explicitly choose what to share.
```

### Never Shared
```
- Actual weight numbers
- Specific calorie/macro intake
- Meal photos or logs
- Body measurements
- Health data
- Private notes
```

## Challenge Types

### 1. Consistency Challenges
```json
{
  "type": "consistency",
  "examples": [
    {
      "name": "7-Day Logging Streak",
      "goal": "Log at least one meal every day for 7 days",
      "duration_days": 7,
      "scoring": "binary (complete or not)",
      "difficulty": "easy"
    },
    {
      "name": "Perfect Week",
      "goal": "Log all 3 meals for 7 consecutive days",
      "duration_days": 7,
      "scoring": "21 possible points (1 per meal)",
      "difficulty": "medium"
    },
    {
      "name": "Monthly Commitment",
      "goal": "Log at least 25 days this month",
      "duration_days": 30,
      "scoring": "days logged",
      "difficulty": "hard"
    }
  ]
}
```

### 2. Nutrition Target Challenges
```json
{
  "type": "nutrition_target",
  "examples": [
    {
      "name": "Protein Power Week",
      "goal": "Hit protein target 5 out of 7 days",
      "duration_days": 7,
      "scoring": "days target hit",
      "difficulty": "medium"
    },
    {
      "name": "Calorie Consistency",
      "goal": "Stay within 10% of calorie goal for 7 days",
      "duration_days": 7,
      "scoring": "days within range",
      "difficulty": "medium"
    },
    {
      "name": "Hydration Hero",
      "goal": "Log 64+ oz water daily for 14 days",
      "duration_days": 14,
      "scoring": "days target hit",
      "difficulty": "medium"
    }
  ]
}
```

### 3. Activity Challenges
```json
{
  "type": "activity",
  "examples": [
    {
      "name": "Step Challenge",
      "goal": "Accumulate most steps over the week",
      "duration_days": 7,
      "scoring": "total steps",
      "difficulty": "varies"
    },
    {
      "name": "Workout Warriors",
      "goal": "Log 4+ workouts this week",
      "duration_days": 7,
      "scoring": "workouts logged",
      "difficulty": "medium"
    },
    {
      "name": "Active Minutes",
      "goal": "150+ active minutes per week",
      "duration_days": 7,
      "scoring": "total active minutes",
      "difficulty": "medium"
    }
  ]
}
```

### 4. Team Challenges
```json
{
  "type": "team",
  "examples": [
    {
      "name": "Team Logging",
      "goal": "Team with highest combined logging days",
      "team_size": "2-5",
      "duration_days": 14,
      "scoring": "sum of team members' logged days"
    },
    {
      "name": "Relay Challenge",
      "goal": "Each team member maintains streak, passes to next",
      "team_size": "4",
      "duration_days": 28,
      "scoring": "consecutive days team streak maintained"
    }
  ]
}
```

## Leaderboard System

### Individual Leaderboards
```json
{
  "leaderboard_types": [
    {
      "name": "Logging Streak",
      "metric": "consecutive_days_logged",
      "refresh": "real-time",
      "display": "Top 10 friends + your rank"
    },
    {
      "name": "Weekly Adherence",
      "metric": "adherence_score_this_week",
      "refresh": "daily",
      "display": "Percentile rank among friends"
    },
    {
      "name": "Protein Champions",
      "metric": "days_protein_target_hit_this_month",
      "refresh": "daily",
      "display": "Rank among opted-in friends"
    },
    {
      "name": "Steps Leader",
      "metric": "steps_this_week",
      "refresh": "hourly",
      "display": "Rank with step count"
    }
  ]
}
```

### Display Format
```
🏆 Weekly Logging Leaderboard

1. 🥇 Sarah M. - 7/7 days (100%)
2. 🥈 Mike T. - 7/7 days (100%)
3. 🥉 You - 6/7 days (86%)
4. ⭐ Jennifer K. - 5/7 days (71%)
5. ⭐ David R. - 5/7 days (71%)

Your best week ever! 🎉
```

## Accountability Partner System

### Matching Criteria
```python
def find_accountability_match(user):
    candidates = get_available_users()

    for candidate in candidates:
        score = 0

        # Similar goals
        if similar_goal_type(user, candidate):
            score += 30

        # Similar experience level
        if abs(user.days_on_app - candidate.days_on_app) < 30:
            score += 20

        # Compatible schedules (for check-ins)
        if timezone_compatible(user, candidate):
            score += 15

        # Activity level match
        if similar_activity_level(user, candidate):
            score += 15

        # Complementary strengths
        if user.struggles_with in candidate.strong_at:
            score += 20

    return top_matches(candidates, by=score, limit=3)
```

### Partner Features
```
- Daily check-in prompts
- Shared milestone celebrations
- Private messaging
- Gentle nudges when partner misses logging
- Weekly progress comparison (opt-in)
- Shared challenges
```

## Response Format

```json
{
  "ok": true,
  "social_dashboard": {
    "friends_count": 8,
    "active_challenges": 2,
    "pending_invites": 1,
    "accountability_partner": {
      "name": "Sarah M.",
      "connected_days": 45,
      "their_streak": 12,
      "last_active": "2 hours ago"
    }
  },
  "active_challenges": [
    {
      "id": "ch_abc123",
      "name": "Protein Power Week",
      "type": "nutrition_target",
      "participants": 4,
      "your_progress": {
        "days_completed": 4,
        "days_target_hit": 3,
        "rank": 2,
        "points": 3
      },
      "leader": {
        "name": "Mike T.",
        "points": 4
      },
      "ends_in": "3 days",
      "your_status": "In contention! Hit protein today to tie for 1st"
    }
  ],
  "leaderboards": {
    "logging_streak": {
      "your_rank": 3,
      "your_value": 14,
      "leader_value": 28,
      "total_participants": 8
    },
    "weekly_adherence": {
      "your_rank": 2,
      "your_percentile": 88,
      "your_score": 85
    }
  },
  "recent_celebrations": [
    {
      "friend": "Jennifer K.",
      "achievement": "30-day logging streak",
      "when": "2 hours ago",
      "your_reaction": null,
      "reactions_count": 3
    },
    {
      "friend": "David R.",
      "achievement": "Hit protein target 7 days straight",
      "when": "1 day ago",
      "your_reaction": "🎉",
      "reactions_count": 5
    }
  ],
  "suggested_actions": [
    {
      "action": "challenge_friend",
      "message": "Challenge Sarah to a step competition this week",
      "reason": "You both average similar step counts"
    },
    {
      "action": "celebrate",
      "message": "Jennifer just hit a milestone - send encouragement!",
      "friend": "Jennifer K."
    }
  ]
}
```

## Notification Types

### Motivational Nudges
```
- "Sarah just logged breakfast - you got this too! 💪"
- "3 friends already hit their protein goal today"
- "You're 1 day away from passing Mike on the streak leaderboard!"
```

### Challenge Updates
```
- "Protein Power Week starts tomorrow - 4 friends joined!"
- "You moved up to 2nd place in the step challenge!"
- "Final day of the challenge - you're tied for 1st!"
```

### Celebrations
```
- "🎉 Congratulations! You won the Weekly Logging Challenge!"
- "Jennifer just celebrated hitting her goal - send some love!"
- "Your accountability partner hit a new personal best!"
```

### Gentle Accountability
```
- "Your partner Sarah hasn't logged today - send encouragement?"
- "You're 1 day from breaking your streak - don't forget to log!"
- "The challenge ends tomorrow - log today to secure your rank!"
```

## API Endpoints Required

```
GET /api/v1/social/dashboard            - Social home screen
GET /api/v1/social/friends              - Friend list
POST /api/v1/social/friends/add         - Add friend
POST /api/v1/social/friends/remove      - Remove friend
GET /api/v1/social/challenges           - Available and active challenges
POST /api/v1/social/challenges/create   - Create new challenge
POST /api/v1/social/challenges/join     - Join challenge
GET /api/v1/social/challenges/:id       - Challenge details
GET /api/v1/social/leaderboards         - All leaderboards
GET /api/v1/social/leaderboards/:type   - Specific leaderboard
POST /api/v1/social/celebrate           - React to friend achievement
GET /api/v1/social/partner              - Accountability partner info
POST /api/v1/social/partner/find        - Find partner match
POST /api/v1/social/partner/message     - Send partner message
GET /api/v1/social/notifications        - Social notifications
PUT /api/v1/social/privacy              - Update sharing preferences
```

## Gamification Elements

### Badges
```
🌟 First Friend - Connected with first friend
👥 Social Butterfly - 5+ friends connected
🏆 Challenge Champion - Won first challenge
🔥 Team Player - Completed team challenge
💪 Accountability Ace - 30 days with partner
🎯 Perfect Week - 100% adherence in challenge
```

### Rewards
```
- Custom profile badges
- Early access to new features
- Ability to create custom challenges
- Increased friend limit
- Special celebration animations
```
