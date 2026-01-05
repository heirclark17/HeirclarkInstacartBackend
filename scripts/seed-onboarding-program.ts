// scripts/seed-onboarding-program.ts
// Seed the 7-Day Onboarding Program with CBT-based content

import 'dotenv/config';
import { Pool } from 'pg';

const DATABASE_URL = process.env.DATABASE_URL || '';

if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : undefined,
});

// 7-Day Onboarding Program Definition
const ONBOARDING_PROGRAM = {
  type: 'onboarding',
  name: '7-Day Kickstart',
  description: 'Build the foundation for lasting health habits. Learn to track nutrition, understand your body, and create sustainable routines with daily guidance from your AI coach.',
  duration_days: 7,
  difficulty: 'beginner',
  category: 'foundations',
  min_completion_rate: 0.6,
  thumbnail_url: 'https://images.unsplash.com/photo-1490645935967-10de6ba17061?w=400',
  coach_name: 'Coach Alex',
  estimated_daily_minutes: 15,
  days: [
    // Day 1: Welcome & First Log
    {
      day: 1,
      title: 'Welcome to Your Journey',
      description: 'Set your foundation by logging your first meal and understanding why tracking matters.',
      estimated_minutes: 15,
      tasks: [
        {
          id: 'd1_welcome',
          type: 'lesson',
          title: 'Why Tracking Changes Everything',
          duration_minutes: 5,
          content: {
            text: `Welcome to Heirclark! You've just taken the most important step toward transforming your health.

**Here's the truth about nutrition:** Most people have no idea what they're actually eating. Studies show we underestimate our calorie intake by 40-50%. That's not a character flaw—it's just how our brains work.

**Tracking changes this.** When you log your food, you:
- See patterns you never noticed
- Make informed decisions instead of guessing
- Build awareness that becomes automatic over time

**The goal isn't perfection.** It's awareness. You don't need to hit exact numbers from day one. Just start noticing.

Over the next 7 days, we'll build your tracking habit step by step. Today, we start simple: one meal.`,
            image_url: 'https://images.unsplash.com/photo-1498837167922-ddd27525d352?w=600',
          },
          points: 10,
        },
        {
          id: 'd1_first_log',
          type: 'action',
          title: 'Log Your First Meal',
          duration_minutes: 5,
          content: {
            instructions: 'Open the Food Log and add what you ate for your most recent meal. Don\'t worry about being perfect—just get something logged!',
            action_type: 'log_meal',
            success_criteria: 'meal_logged',
          },
          points: 20,
        },
        {
          id: 'd1_reflection',
          type: 'reflection',
          title: 'How Did That Feel?',
          duration_minutes: 3,
          content: {
            prompt: 'What surprised you about logging your first meal? Was it easier or harder than expected?',
            min_length: 20,
            suggestions: [
              'I noticed...',
              'I was surprised that...',
              'The hardest part was...',
            ],
          },
          points: 15,
        },
        {
          id: 'd1_quiz',
          type: 'quiz',
          title: 'Quick Check',
          duration_minutes: 2,
          content: {
            questions: [
              {
                question: 'What\'s the main benefit of food tracking?',
                options: [
                  'Counting every calorie perfectly',
                  'Building awareness of what you eat',
                  'Feeling guilty about food choices',
                  'Eating less food overall',
                ],
                correct_index: 1,
                explanation: 'Tracking is about awareness, not perfection. When you see what you eat, you can make better decisions.',
              },
            ],
            passing_score: 100,
          },
          points: 10,
        },
      ],
    },
    // Day 2: Understanding Macros
    {
      day: 2,
      title: 'The Power of Protein',
      description: 'Learn why protein is your secret weapon for energy, muscle, and staying full.',
      estimated_minutes: 15,
      tasks: [
        {
          id: 'd2_lesson',
          type: 'lesson',
          title: 'Protein: Your Body\'s Building Block',
          duration_minutes: 5,
          content: {
            text: `Today we focus on the most important macronutrient for body transformation: **protein**.

**Why protein matters:**
- Builds and repairs muscle tissue
- Keeps you feeling full longer than carbs or fat
- Burns more calories during digestion (thermic effect)
- Preserves muscle when losing weight

**How much do you need?**
A good starting point: **0.7-1g per pound of body weight** if you're active.
For a 150lb person, that's 105-150g of protein per day.

**High-protein foods to know:**
- Chicken breast: 31g per 4oz
- Greek yogurt: 17g per cup
- Eggs: 6g each
- Salmon: 25g per 4oz
- Lentils: 18g per cup

**Today's challenge:** Pay attention to the protein in your meals. Are you getting enough at each meal?`,
            image_url: 'https://images.unsplash.com/photo-1532550907401-a500c9a57435?w=600',
          },
          points: 10,
        },
        {
          id: 'd2_log_meals',
          type: 'action',
          title: 'Log All Meals Today',
          duration_minutes: 5,
          content: {
            instructions: 'Log everything you eat today. At the end of the day, check your total protein intake.',
            action_type: 'log_all_meals',
            success_criteria: 'meals_logged_3',
          },
          points: 25,
        },
        {
          id: 'd2_reflection',
          type: 'reflection',
          title: 'Protein Check-In',
          duration_minutes: 3,
          content: {
            prompt: 'Looking at your food log, how much protein did you eat today? Were you surprised by the amount?',
            min_length: 20,
            suggestions: [
              'My total protein was about...',
              'I was surprised because...',
              'Tomorrow I could add more protein by...',
            ],
          },
          points: 15,
        },
        {
          id: 'd2_quiz',
          type: 'quiz',
          title: 'Protein Quiz',
          duration_minutes: 2,
          content: {
            questions: [
              {
                question: 'About how much protein should an active 150lb person aim for daily?',
                options: [
                  '50-75g',
                  '105-150g',
                  '200-250g',
                  '300g+',
                ],
                correct_index: 1,
                explanation: 'Active people benefit from 0.7-1g of protein per pound of body weight. For 150lbs, that\'s 105-150g.',
              },
            ],
            passing_score: 100,
          },
          points: 10,
        },
      ],
    },
    // Day 3: Calories & Energy Balance
    {
      day: 3,
      title: 'Calories: The Energy Equation',
      description: 'Understand how calories work and find your personal energy needs.',
      estimated_minutes: 15,
      tasks: [
        {
          id: 'd3_lesson',
          type: 'lesson',
          title: 'Understanding Energy Balance',
          duration_minutes: 6,
          content: {
            text: `Today we demystify calories—the currency of energy in your body.

**The Simple Truth:**
- **Calories in < Calories out** = Weight loss
- **Calories in > Calories out** = Weight gain
- **Calories in = Calories out** = Maintenance

**But it's not just about the number.** Where those calories come from matters for:
- How full you feel
- Your energy levels
- Muscle vs. fat changes
- Long-term health

**Your daily calorie needs depend on:**
- Basal Metabolic Rate (BMR): Calories burned just existing
- Activity level: Exercise and daily movement
- Goals: Losing, gaining, or maintaining weight

**A sustainable deficit for fat loss:** 300-500 calories below maintenance
**For muscle gain:** 200-300 calories above maintenance

**Key insight:** Small, consistent changes beat dramatic restrictions. A 500 calorie daily deficit = 1 pound lost per week.`,
            image_url: 'https://images.unsplash.com/photo-1476224203421-9ac39bcb3327?w=600',
          },
          points: 10,
        },
        {
          id: 'd3_calculate',
          type: 'action',
          title: 'Calculate Your Targets',
          duration_minutes: 5,
          content: {
            instructions: 'Go to Settings > Goals and enter your current weight, height, and activity level to get personalized calorie and macro targets.',
            action_type: 'set_goals',
            success_criteria: 'goals_set',
          },
          points: 20,
        },
        {
          id: 'd3_log',
          type: 'action',
          title: 'Track Your Full Day',
          duration_minutes: 3,
          content: {
            instructions: 'Log all your meals and snacks today. Compare your total to your new calorie target.',
            action_type: 'log_all_meals',
            success_criteria: 'meals_logged_3',
          },
          points: 20,
        },
        {
          id: 'd3_reflection',
          type: 'reflection',
          title: 'Energy Awareness',
          duration_minutes: 3,
          content: {
            prompt: 'How did your actual calorie intake compare to your target? What\'s one small change you could make?',
            min_length: 30,
            suggestions: [
              'I ate about... compared to my target of...',
              'One change I could make is...',
              'I noticed that...',
            ],
          },
          points: 15,
        },
      ],
    },
    // Day 4: Building Your Routine
    {
      day: 4,
      title: 'Making It Automatic',
      description: 'Learn the science of habit formation and create your tracking routine.',
      estimated_minutes: 15,
      tasks: [
        {
          id: 'd4_lesson',
          type: 'lesson',
          title: 'The Habit Loop',
          duration_minutes: 5,
          content: {
            text: `Willpower is limited. Habits are forever. Today we build your automatic tracking system.

**Every habit has three parts:**
1. **Cue** - The trigger that starts the behavior
2. **Routine** - The behavior itself
3. **Reward** - The benefit you get

**For food tracking, try this:**
- **Cue:** Sitting down to eat (before you take the first bite)
- **Routine:** Open the app and log your meal
- **Reward:** The satisfaction of seeing your progress + the data itself

**Pro tips for habit success:**
- **Stack it:** Attach tracking to something you already do (sit down to eat → log food)
- **Make it easy:** Keep the app on your home screen
- **Start small:** Even logging one meal is a win
- **Be consistent:** Same time, same trigger, every day

**The 2-minute rule:** If a habit takes less than 2 minutes, do it immediately. Logging a meal? That's a 2-minute task.

**Remember:** You're not trying to be perfect. You're trying to be consistent.`,
            image_url: 'https://images.unsplash.com/photo-1434030216411-0b793f4b4173?w=600',
          },
          points: 10,
        },
        {
          id: 'd4_habit_setup',
          type: 'action',
          title: 'Design Your Habit',
          duration_minutes: 5,
          content: {
            instructions: 'Create your personal tracking habit. Choose a cue (e.g., "When I sit down to eat..."), the routine ("I will open the app and log my food"), and acknowledge your reward ("I\'ll see my progress and feel in control").',
            action_type: 'create_habit',
            success_criteria: 'habit_created',
          },
          points: 20,
        },
        {
          id: 'd4_practice',
          type: 'action',
          title: 'Practice Your Habit',
          duration_minutes: 3,
          content: {
            instructions: 'Log your next meal using your new habit cue. Notice the moment you sit down and immediately open the app.',
            action_type: 'log_meal',
            success_criteria: 'meal_logged',
          },
          points: 15,
        },
        {
          id: 'd4_reflection',
          type: 'reflection',
          title: 'Habit Design Reflection',
          duration_minutes: 3,
          content: {
            prompt: 'What cue will you use to trigger your tracking habit? When and where will this happen?',
            min_length: 30,
            suggestions: [
              'My tracking cue will be...',
              'This will work for me because...',
              'The hardest part might be...',
            ],
          },
          points: 15,
        },
      ],
    },
    // Day 5: Listening to Your Body
    {
      day: 5,
      title: 'Beyond the Numbers',
      description: 'Learn to combine data with body awareness for sustainable success.',
      estimated_minutes: 15,
      tasks: [
        {
          id: 'd5_lesson',
          type: 'lesson',
          title: 'The Mind-Body Connection',
          duration_minutes: 5,
          content: {
            text: `Numbers tell one story. Your body tells another. Today we learn to listen to both.

**Hunger vs. Appetite:**
- **Hunger:** Physical need for food (empty stomach, low energy)
- **Appetite:** Psychological desire to eat (stress, boredom, habit)

**The Hunger Scale (1-10):**
1-2: Starving, irritable, can't think
3-4: Very hungry, stomach growling
5-6: Comfortable, satisfied
7-8: Full, slightly uncomfortable
9-10: Stuffed, painfully full

**Aim to:** Start eating at 3-4, stop at 6-7

**Check in with yourself before eating:**
- Am I physically hungry or emotionally hungry?
- What does my body actually need right now?
- How will I feel after eating this?

**Tracking tip:** Add notes to your meals about how you felt. This builds awareness over time.

**The goal:** Use the data AND your body's signals together. Neither alone tells the full story.`,
            image_url: 'https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?w=600',
          },
          points: 10,
        },
        {
          id: 'd5_awareness',
          type: 'action',
          title: 'Mindful Meal',
          duration_minutes: 5,
          content: {
            instructions: 'Before your next meal, rate your hunger on a 1-10 scale. Eat slowly and stop when you reach 6-7. Log the meal with a note about your hunger levels.',
            action_type: 'mindful_meal',
            success_criteria: 'meal_with_note',
          },
          points: 20,
        },
        {
          id: 'd5_log',
          type: 'action',
          title: 'Full Day with Notes',
          duration_minutes: 3,
          content: {
            instructions: 'Log all meals today. Add a brief note to at least one meal about how you felt (hungry, stressed, tired, etc.).',
            action_type: 'log_all_meals',
            success_criteria: 'meals_logged_3',
          },
          points: 20,
        },
        {
          id: 'd5_reflection',
          type: 'reflection',
          title: 'Body Awareness Check',
          duration_minutes: 3,
          content: {
            prompt: 'What did you notice about your hunger patterns today? When were you truly hungry vs. eating for other reasons?',
            min_length: 40,
            suggestions: [
              'I noticed I was most hungry when...',
              'I ate without being hungry because...',
              'Paying attention to hunger helped me...',
            ],
          },
          points: 15,
        },
      ],
    },
    // Day 6: Planning Ahead
    {
      day: 6,
      title: 'Set Yourself Up for Success',
      description: 'Learn to plan meals ahead and use grocery lists to stay on track.',
      estimated_minutes: 15,
      tasks: [
        {
          id: 'd6_lesson',
          type: 'lesson',
          title: 'The Power of Planning',
          duration_minutes: 5,
          content: {
            text: `The best time to decide what to eat is NOT when you're hungry. It's before.

**Why planning works:**
- Removes decision fatigue when you're tired/hungry
- Ensures you have the right foods available
- Prevents impulsive choices
- Saves time and money

**Simple planning strategies:**

**1. Plan your protein first**
Decide on your protein source for each meal, then build around it.

**2. Prep in batches**
Cook protein and grains on Sunday for easy weekday meals.

**3. Use the grocery list feature**
Plan your meals → Generate a shopping list → Buy only what you need.

**4. Have backup options**
Keep quick, healthy options ready for busy days:
- Greek yogurt + fruit
- Pre-cooked chicken + salad
- Eggs (cook in 5 minutes)

**The 80/20 rule:** Plan 80% of your meals. Leave 20% for flexibility and life.

**Today's challenge:** Plan tomorrow's meals in advance.`,
            image_url: 'https://images.unsplash.com/photo-1466637574441-749b8f19452f?w=600',
          },
          points: 10,
        },
        {
          id: 'd6_plan',
          type: 'action',
          title: 'Plan Tomorrow',
          duration_minutes: 7,
          content: {
            instructions: 'Use the Meal Planner to plan all your meals for tomorrow. Don\'t worry about being perfect—just get a rough plan in place.',
            action_type: 'create_meal_plan',
            success_criteria: 'plan_created',
          },
          points: 25,
        },
        {
          id: 'd6_grocery',
          type: 'action',
          title: 'Create a Grocery List',
          duration_minutes: 3,
          content: {
            instructions: 'Review your meal plan and create a shopping list for any ingredients you need. You can generate one automatically from your plan!',
            action_type: 'create_grocery_list',
            success_criteria: 'list_created',
          },
          points: 15,
        },
        {
          id: 'd6_reflection',
          type: 'reflection',
          title: 'Planning Reflection',
          duration_minutes: 3,
          content: {
            prompt: 'How does having a plan for tomorrow make you feel? What\'s one meal you\'re looking forward to?',
            min_length: 30,
            suggestions: [
              'Having a plan makes me feel...',
              'Tomorrow I\'m excited to eat...',
              'Planning helped me realize...',
            ],
          },
          points: 15,
        },
      ],
    },
    // Day 7: Celebration & Next Steps
    {
      day: 7,
      title: 'You Did It! What\'s Next?',
      description: 'Celebrate your progress and set yourself up for continued success.',
      estimated_minutes: 15,
      tasks: [
        {
          id: 'd7_lesson',
          type: 'lesson',
          title: 'Celebrating Your Progress',
          duration_minutes: 5,
          content: {
            text: `**Congratulations!** You've completed 7 days of building your nutrition foundation. That's huge.

**What you've accomplished:**
✅ Logged your first meals
✅ Learned about protein and calories
✅ Built a tracking habit
✅ Connected with your body's signals
✅ Planned ahead for success

**Here's what research shows:**
People who track their food for at least 7 days are **3x more likely** to achieve their health goals than those who don't.

You're now part of that group.

**What's next?**

1. **Keep the streak going** - Your tracking habit is just getting started
2. **Explore more programs** - Try our 4-Week Protein Challenge or Mindful Eating course
3. **Set a specific goal** - Use what you've learned to target something concrete
4. **Join the community** - Connect with others on the same journey

**Remember:** This isn't about perfection. It's about progress. Every meal you log, every day you show up—that's success.

You've got this. 💪`,
            image_url: 'https://images.unsplash.com/photo-1552674605-db6ffd4facb5?w=600',
          },
          points: 15,
        },
        {
          id: 'd7_review',
          type: 'action',
          title: 'Review Your Week',
          duration_minutes: 5,
          content: {
            instructions: 'Look at your nutrition summary for the past 7 days. Notice your patterns—when did you eat well? What challenged you?',
            action_type: 'view_summary',
            success_criteria: 'summary_viewed',
          },
          points: 20,
        },
        {
          id: 'd7_goal',
          type: 'action',
          title: 'Set Your Next Goal',
          duration_minutes: 3,
          content: {
            instructions: 'Based on what you learned this week, set one specific goal for the next 30 days. Make it measurable (e.g., "Log food 5 days per week" or "Hit protein goal 4 days per week").',
            action_type: 'set_goal',
            success_criteria: 'goal_set',
          },
          points: 20,
        },
        {
          id: 'd7_reflection',
          type: 'reflection',
          title: 'Your Journey Reflection',
          duration_minutes: 5,
          content: {
            prompt: 'What was your biggest insight from this week? What will you do differently going forward?',
            min_length: 50,
            suggestions: [
              'The most important thing I learned was...',
              'I was surprised to discover that...',
              'Going forward, I will...',
              'My goal for the next month is...',
            ],
          },
          points: 25,
        },
        {
          id: 'd7_quiz',
          type: 'quiz',
          title: 'Final Quiz',
          duration_minutes: 3,
          content: {
            questions: [
              {
                question: 'What are the three parts of a habit loop?',
                options: [
                  'Start, Middle, End',
                  'Cue, Routine, Reward',
                  'Plan, Execute, Review',
                  'Morning, Afternoon, Evening',
                ],
                correct_index: 1,
                explanation: 'Every habit has a Cue (trigger), Routine (behavior), and Reward (benefit).',
              },
              {
                question: 'On the hunger scale, when should you ideally stop eating?',
                options: [
                  '1-2 (starving)',
                  '3-4 (very hungry)',
                  '6-7 (satisfied)',
                  '9-10 (stuffed)',
                ],
                correct_index: 2,
                explanation: 'Aim to stop eating at 6-7 on the hunger scale—satisfied but not stuffed.',
              },
              {
                question: 'What\'s the recommended protein intake for active people?',
                options: [
                  '0.3-0.5g per pound of body weight',
                  '0.7-1g per pound of body weight',
                  '2-3g per pound of body weight',
                  'Protein doesn\'t matter',
                ],
                correct_index: 1,
                explanation: 'Active people benefit from 0.7-1g of protein per pound of body weight.',
              },
            ],
            passing_score: 66,
          },
          points: 20,
        },
      ],
    },
  ],
};

async function seedOnboardingProgram() {
  console.log('Seeding 7-Day Onboarding Program...\n');

  try {
    // Check if program already exists
    const existing = await pool.query(
      `SELECT id FROM hc_programs WHERE type = 'onboarding' AND name = $1`,
      [ONBOARDING_PROGRAM.name]
    );

    if (existing.rows.length > 0) {
      console.log('Onboarding program already exists. Updating...');

      await pool.query(
        `UPDATE hc_programs SET
          description = $1,
          duration_days = $2,
          difficulty = $3,
          category = $4,
          days = $5,
          min_completion_rate = $6,
          thumbnail_url = $7,
          coach_name = $8,
          estimated_daily_minutes = $9,
          updated_at = NOW()
        WHERE id = $10`,
        [
          ONBOARDING_PROGRAM.description,
          ONBOARDING_PROGRAM.duration_days,
          ONBOARDING_PROGRAM.difficulty,
          ONBOARDING_PROGRAM.category,
          JSON.stringify(ONBOARDING_PROGRAM.days),
          ONBOARDING_PROGRAM.min_completion_rate,
          ONBOARDING_PROGRAM.thumbnail_url,
          ONBOARDING_PROGRAM.coach_name,
          ONBOARDING_PROGRAM.estimated_daily_minutes,
          existing.rows[0].id,
        ]
      );

      console.log(`✓ Updated program: ${ONBOARDING_PROGRAM.name}`);
    } else {
      // Insert new program
      const result = await pool.query(
        `INSERT INTO hc_programs (
          type, name, description, duration_days, difficulty, category,
          days, min_completion_rate, thumbnail_url, coach_name, estimated_daily_minutes
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING id`,
        [
          ONBOARDING_PROGRAM.type,
          ONBOARDING_PROGRAM.name,
          ONBOARDING_PROGRAM.description,
          ONBOARDING_PROGRAM.duration_days,
          ONBOARDING_PROGRAM.difficulty,
          ONBOARDING_PROGRAM.category,
          JSON.stringify(ONBOARDING_PROGRAM.days),
          ONBOARDING_PROGRAM.min_completion_rate,
          ONBOARDING_PROGRAM.thumbnail_url,
          ONBOARDING_PROGRAM.coach_name,
          ONBOARDING_PROGRAM.estimated_daily_minutes,
        ]
      );

      console.log(`✓ Created program: ${ONBOARDING_PROGRAM.name} (ID: ${result.rows[0].id})`);
    }

    // Summary
    console.log('\n========================================');
    console.log('Program Summary:');
    console.log(`  Name: ${ONBOARDING_PROGRAM.name}`);
    console.log(`  Duration: ${ONBOARDING_PROGRAM.duration_days} days`);
    console.log(`  Coach: ${ONBOARDING_PROGRAM.coach_name}`);
    console.log(`  Est. daily time: ${ONBOARDING_PROGRAM.estimated_daily_minutes} minutes`);
    console.log('\n  Daily Content:');

    for (const day of ONBOARDING_PROGRAM.days) {
      const totalPoints = day.tasks.reduce((sum, t) => sum + (t.points || 0), 0);
      console.log(`    Day ${day.day}: "${day.title}" (${day.tasks.length} tasks, ${totalPoints} points)`);
    }

    const totalTasks = ONBOARDING_PROGRAM.days.reduce((sum, d) => sum + d.tasks.length, 0);
    const totalPoints = ONBOARDING_PROGRAM.days.reduce(
      (sum, d) => sum + d.tasks.reduce((s, t) => s + (t.points || 0), 0), 0
    );

    console.log(`\n  Total: ${totalTasks} tasks, ${totalPoints} points available`);
    console.log('========================================\n');

  } catch (error) {
    console.error('Error seeding program:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

seedOnboardingProgram().catch(console.error);
