// src/routes/programs.ts
// Programs API Routes for Heirclark Behavior Change Platform
// Handles program enrollment, progress tracking, and habit management

import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { ProgramsDB } from '../db/programs';
import {
  Program,
  UserProgramEnrollment,
  ProgramDayResponse,
  TaskCompleteResponse,
  TaskResponseData,
} from '../types/programs';

// ==========================================================================
// 7-Day Onboarding Program Definition
// ==========================================================================

const ONBOARDING_PROGRAM: Partial<Program> = {
  type: 'onboarding',
  name: '7-Day Kickstart',
  description: 'Build the foundation for your nutrition journey with daily lessons, reflections, and your first meal plan.',
  duration_days: 7,
  difficulty: 'beginner',
  category: 'Getting Started',
  min_completion_rate: 0.6,
  coach_name: 'Coach Alex',
  estimated_daily_minutes: 10,
  days: [
    // Day 1: Profile & Goals
    {
      day: 1,
      title: 'Your Starting Point',
      subtitle: 'Set your foundation',
      theme: 'Goal Setting',
      estimated_minutes: 12,
      tasks: [
        {
          id: 'day1-lesson',
          type: 'lesson',
          title: 'Why Goals Matter',
          required: true,
          order: 1,
          estimated_minutes: 3,
          content: {
            type: 'lesson',
            body_markdown: `# Your Journey Starts Here

Every successful transformation begins with clarity. Today, we'll establish where you're starting and where you want to go.

**The Science**: Research shows that people who write down specific goals are 42% more likely to achieve them. Not vague wishes—concrete targets.

**Your Focus Today**: Understanding your unique body and setting a realistic, personalized target.`,
            key_takeaways: [
              'Written goals dramatically increase success rates',
              'Your starting point is just data, not judgment',
              'Sustainable change comes from clarity',
            ],
            cbt_technique: 'goal_setting',
          },
        },
        {
          id: 'day1-action-profile',
          type: 'action',
          title: 'Complete Your Profile',
          required: true,
          order: 2,
          estimated_minutes: 5,
          content: {
            type: 'action',
            action_type: 'custom',
            instructions: 'Enter your height, weight, age, and activity level to calculate your personalized targets.',
            verification_method: 'app_data',
            deep_link: '/profile/setup',
          },
        },
        {
          id: 'day1-reflection',
          type: 'reflection',
          title: 'Your Why',
          required: false,
          order: 3,
          estimated_minutes: 4,
          content: {
            type: 'reflection',
            prompt: 'What made you decide to start this journey today? What will be different in your life when you reach your goal?',
            example_response: 'I want to have more energy to play with my kids and feel confident at my high school reunion next year.',
            min_characters: 50,
          },
        },
      ],
    },

    // Day 2: Nutrition Basics
    {
      day: 2,
      title: 'Nutrition 101',
      subtitle: 'Understanding macros',
      theme: 'Macro Fundamentals',
      estimated_minutes: 10,
      tasks: [
        {
          id: 'day2-lesson',
          type: 'lesson',
          title: 'The Three Macros',
          required: true,
          order: 1,
          estimated_minutes: 4,
          content: {
            type: 'lesson',
            body_markdown: `# Protein, Carbs, and Fat

Your body needs all three macronutrients. Here's the simple truth:

**Protein** (4 cal/g): Building blocks for muscle. Keeps you full. Aim for 0.8-1g per pound of goal body weight.

**Carbohydrates** (4 cal/g): Your body's preferred energy source. Not the enemy—just be strategic.

**Fat** (9 cal/g): Essential for hormones, brain function, and absorbing vitamins. Don't fear it.

**The Key Insight**: It's not about eliminating any macro—it's about finding YOUR right balance.`,
            key_takeaways: [
              'All three macros are essential',
              'Protein is key for satiety and muscle preservation',
              'Balance matters more than elimination',
            ],
          },
        },
        {
          id: 'day2-action-log',
          type: 'action',
          title: 'Log Your First Meal',
          required: true,
          order: 2,
          estimated_minutes: 4,
          content: {
            type: 'action',
            action_type: 'log_meal',
            instructions: 'Take a photo or search for your next meal. See how it fits your daily targets.',
            verification_method: 'app_data',
            deep_link: '/log/meal',
          },
        },
        {
          id: 'day2-quiz',
          type: 'quiz',
          title: 'Quick Check',
          required: false,
          order: 3,
          estimated_minutes: 2,
          content: {
            type: 'quiz',
            questions: [
              {
                id: 'q1',
                question: 'Which macro has the most calories per gram?',
                options: ['Protein', 'Carbohydrates', 'Fat', 'They\'re all the same'],
                correct_index: 2,
                explanation: 'Fat has 9 calories per gram, while protein and carbs have 4 each.',
              },
            ],
            passing_score: 100,
            show_correct_answers: true,
          },
        },
      ],
    },

    // Day 3: Understanding Hunger
    {
      day: 3,
      title: 'Hunger Signals',
      subtitle: 'Listen to your body',
      theme: 'Intuitive Awareness',
      estimated_minutes: 10,
      tasks: [
        {
          id: 'day3-lesson',
          type: 'lesson',
          title: 'The Hunger Scale',
          required: true,
          order: 1,
          estimated_minutes: 4,
          content: {
            type: 'lesson',
            body_markdown: `# Reading Your Body's Signals

Not all hunger is the same. Learning to distinguish physical hunger from emotional hunger is a superpower.

**The Hunger Scale (1-10):**
- 1-2: Starving, irritable, can't focus
- 3-4: Hungry, ready to eat
- 5-6: Neutral, comfortable
- 7-8: Satisfied, pleasantly full
- 9-10: Stuffed, uncomfortable

**The Goal**: Eat when you're at 3-4, stop when you're at 7.

**Watch For**: Eating from boredom, stress, or habit rather than true hunger.`,
            key_takeaways: [
              'Physical hunger builds gradually; emotional hunger hits suddenly',
              'Aim to eat at 3-4 and stop at 7 on the hunger scale',
              'Awareness is the first step to change',
            ],
            cbt_technique: 'mindfulness',
          },
        },
        {
          id: 'day3-reflection',
          type: 'reflection',
          title: 'Your Hunger Patterns',
          required: true,
          order: 2,
          estimated_minutes: 4,
          content: {
            type: 'reflection',
            prompt: 'Think about the last time you ate when you weren\'t physically hungry. What triggered it? How did you feel afterward?',
            min_characters: 50,
            follow_up_prompts: [
              'What could you do differently next time?',
            ],
          },
        },
        {
          id: 'day3-habit',
          type: 'habit_check',
          title: 'Hunger Check-In',
          required: false,
          order: 3,
          estimated_minutes: 2,
          content: {
            type: 'habit_check',
            habit_name: 'Pre-meal hunger rating',
            habit_description: 'Before eating, pause and rate your hunger 1-10',
            frequency: 'daily',
            streak_bonus_points: 5,
          },
        },
      ],
    },

    // Day 4: Meal Planning Intro
    {
      day: 4,
      title: 'Plan to Succeed',
      subtitle: 'Your first meal plan',
      theme: 'Meal Planning',
      estimated_minutes: 12,
      tasks: [
        {
          id: 'day4-lesson',
          type: 'lesson',
          title: 'Why Planning Works',
          required: true,
          order: 1,
          estimated_minutes: 3,
          content: {
            type: 'lesson',
            body_markdown: `# The Power of Preparation

"Failing to plan is planning to fail." It sounds cliché because it's true.

**The Research**: People who meal plan:
- Eat 25% more vegetables
- Spend 20% less on food
- Are 50% more likely to hit their calorie targets

**The Simple Truth**: When you're hungry and tired, you make worse decisions. A plan removes the decision.

**Today**: We'll generate your personalized 7-day meal plan.`,
            key_takeaways: [
              'Meal planning removes decision fatigue',
              'Prepared people hit their targets more consistently',
              'Start simple—even planning one meal helps',
            ],
          },
        },
        {
          id: 'day4-action-plan',
          type: 'action',
          title: 'Generate Your Meal Plan',
          required: true,
          order: 2,
          estimated_minutes: 6,
          content: {
            type: 'action',
            action_type: 'custom',
            instructions: 'Review your personalized 7-day meal plan. You can swap any meals you don\'t like.',
            verification_method: 'app_data',
            deep_link: '/meal-plan/generate',
          },
        },
        {
          id: 'day4-coach',
          type: 'coach_video',
          title: 'Coach Tips',
          required: false,
          order: 3,
          estimated_minutes: 3,
          content: {
            type: 'coach_video',
            generate_script: true,
            script_template: 'meal_plan_intro',
          },
        },
      ],
    },

    // Day 5: Building Habits
    {
      day: 5,
      title: 'Habit Architecture',
      subtitle: 'Small changes, big results',
      theme: 'Behavior Change',
      estimated_minutes: 10,
      tasks: [
        {
          id: 'day5-lesson',
          type: 'lesson',
          title: 'The Habit Loop',
          required: true,
          order: 1,
          estimated_minutes: 4,
          content: {
            type: 'lesson',
            body_markdown: `# Cue → Routine → Reward

Every habit follows the same pattern:

1. **Cue**: The trigger that initiates the behavior
2. **Routine**: The behavior itself
3. **Reward**: The benefit you get from it

**Habit Stacking**: Attach a new habit to an existing one.

Example: "After I pour my morning coffee (existing habit), I will take my vitamins (new habit)."

**Start Tiny**: The smaller the habit, the more likely it sticks. "Do 1 pushup" beats "Do 50 pushups" for building consistency.`,
            key_takeaways: [
              'Habits follow the Cue → Routine → Reward loop',
              'Stack new habits onto existing ones',
              'Tiny habits beat ambitious ones for consistency',
            ],
            cbt_technique: 'behavioral_activation',
          },
        },
        {
          id: 'day5-goal',
          type: 'goal_setting',
          title: 'Your Keystone Habit',
          required: true,
          order: 2,
          estimated_minutes: 4,
          content: {
            type: 'goal_setting',
            goal_category: 'habit',
            prompt: 'Choose ONE small nutrition habit to build this week. Use habit stacking: "After I [existing habit], I will [new habit]."',
            suggestions: [
              'After I wake up, I will drink a glass of water',
              'After I sit down for dinner, I will eat vegetables first',
              'After I finish lunch, I will log my meal',
              'After I feel a craving, I will wait 10 minutes',
            ],
            smart_criteria: true,
          },
        },
        {
          id: 'day5-reflection',
          type: 'reflection',
          title: 'Past Habit Success',
          required: false,
          order: 3,
          estimated_minutes: 2,
          content: {
            type: 'reflection',
            prompt: 'Think of a positive habit you\'ve successfully built in the past. What made it stick?',
          },
        },
      ],
    },

    // Day 6: Tracking Progress
    {
      day: 6,
      title: 'Measure What Matters',
      subtitle: 'Track without obsessing',
      theme: 'Progress Tracking',
      estimated_minutes: 10,
      tasks: [
        {
          id: 'day6-lesson',
          type: 'lesson',
          title: 'Beyond the Scale',
          required: true,
          order: 1,
          estimated_minutes: 4,
          content: {
            type: 'lesson',
            body_markdown: `# Multiple Measures of Progress

The scale tells one story. Your body tells many.

**Track These Too:**
- Progress photos (weekly, same conditions)
- How clothes fit
- Energy levels
- Strength in workouts
- Sleep quality
- Mood and mental clarity

**Scale Reality**: Your weight can fluctuate 2-5 lbs daily from water, sodium, hormones, and digestion. Weekly averages matter more than daily numbers.

**The Mindset Shift**: You're not just losing weight—you're gaining health, energy, and confidence.`,
            key_takeaways: [
              'The scale is one data point, not the whole story',
              'Progress photos reveal changes the scale misses',
              'Track trends over weeks, not daily fluctuations',
            ],
          },
        },
        {
          id: 'day6-action-photo',
          type: 'action',
          title: 'First Progress Photo',
          required: false,
          order: 2,
          estimated_minutes: 4,
          content: {
            type: 'action',
            action_type: 'take_photo',
            instructions: 'Take your first progress photo. Front, side, and back if comfortable. Same lighting and time of day each week.',
            verification_method: 'photo_upload',
            deep_link: '/progress/photos',
          },
        },
        {
          id: 'day6-action-weight',
          type: 'action',
          title: 'Log Your Weight',
          required: true,
          order: 3,
          estimated_minutes: 2,
          content: {
            type: 'action',
            action_type: 'log_weight',
            instructions: 'Weigh yourself first thing in the morning, after using the bathroom, before eating.',
            verification_method: 'app_data',
            deep_link: '/log/weight',
          },
        },
      ],
    },

    // Day 7: The Journey Ahead
    {
      day: 7,
      title: 'Your Journey Ahead',
      subtitle: 'Commitment and next steps',
      theme: 'Long-term Success',
      estimated_minutes: 12,
      tasks: [
        {
          id: 'day7-lesson',
          type: 'lesson',
          title: 'The Long Game',
          required: true,
          order: 1,
          estimated_minutes: 4,
          content: {
            type: 'lesson',
            body_markdown: `# This Is Just the Beginning

Congratulations—you've completed 7 days of building your foundation. Here's what comes next:

**The 80/20 Rule**: Aim for consistency, not perfection. Hit your targets 80% of the time and you'll see results.

**Expect Plateaus**: They're normal. Your body adapts. When progress stalls, we'll adjust together.

**Community Matters**: Connect with others on the same journey. Accountability partners double success rates.

**Your Tools Are Ready**:
- Personalized meal plans
- AI-powered food logging
- Progress tracking
- Coach support

You have everything you need. Now it's about showing up, day after day.`,
            key_takeaways: [
              'Consistency beats perfection—aim for 80%',
              'Plateaus are normal; adjust and keep going',
              'You now have all the tools you need',
            ],
          },
        },
        {
          id: 'day7-reflection',
          type: 'reflection',
          title: 'Your Commitment',
          required: true,
          order: 2,
          estimated_minutes: 5,
          content: {
            type: 'reflection',
            prompt: 'Write a commitment letter to yourself. What specifically will you do this week? What obstacles might come up, and how will you handle them?',
            min_characters: 100,
          },
        },
        {
          id: 'day7-coach',
          type: 'coach_video',
          title: 'Congratulations!',
          required: false,
          order: 3,
          estimated_minutes: 3,
          content: {
            type: 'coach_video',
            generate_script: true,
            script_template: 'onboarding_complete',
          },
        },
      ],
    },
  ],
};

// ==========================================================================
// Router Factory
// ==========================================================================

export function createProgramsRouter(pool: Pool): Router {
  const router = Router();
  const programsDB = new ProgramsDB(pool);

  // ==========================================================================
  // GET /api/v1/programs
  // List available programs for user
  // ==========================================================================
  router.get('/', async (req: Request, res: Response) => {
    try {
      const userId = req.query.userId as string || req.headers['x-shopify-customer-id'] as string;

      // Get all programs
      const programs = await programsDB.listPrograms();

      // Get user enrollments if logged in
      let enrollments: UserProgramEnrollment[] = [];
      if (userId) {
        enrollments = await programsDB.getUserEnrollments(userId);
      }

      const enrolledIds = new Set(enrollments.map(e => e.program_id));

      return res.json({
        ok: true,
        data: {
          available: programs.filter(p => !enrolledIds.has(p.id)),
          in_progress: enrollments.filter(e => e.status === 'active'),
          completed: enrollments.filter(e => e.status === 'completed'),
        },
      });
    } catch (error) {
      console.error('[Programs] List error:', error);
      return res.status(500).json({ ok: false, error: 'Failed to list programs' });
    }
  });

  // ==========================================================================
  // GET /api/v1/programs/onboarding
  // Get onboarding program status and content
  // ==========================================================================
  router.get('/onboarding', async (req: Request, res: Response) => {
    try {
      const userId = req.query.userId as string || req.headers['x-shopify-customer-id'] as string;

      if (!userId) {
        // Return program info without enrollment
        return res.json({
          ok: true,
          data: {
            program: ONBOARDING_PROGRAM,
            enrolled: false,
          },
        });
      }

      // Check if user is enrolled
      const enrollments = await programsDB.getUserEnrollments(userId);
      const onboardingEnrollment = enrollments.find(e =>
        e.status === 'active' || e.status === 'completed'
      );

      if (!onboardingEnrollment) {
        return res.json({
          ok: true,
          data: {
            program: ONBOARDING_PROGRAM,
            enrolled: false,
          },
        });
      }

      // Get day progress
      const currentDay = onboardingEnrollment.current_day;
      const dayProgress = await programsDB.getDayProgress(onboardingEnrollment.id, currentDay);
      const taskResponses = await programsDB.getTaskResponses(onboardingEnrollment.id, currentDay);

      return res.json({
        ok: true,
        data: {
          program: ONBOARDING_PROGRAM,
          enrolled: true,
          enrollment: onboardingEnrollment,
          current_day: {
            day: ONBOARDING_PROGRAM.days![currentDay - 1],
            progress: dayProgress,
            task_responses: taskResponses,
          },
        },
      });
    } catch (error) {
      console.error('[Programs] Onboarding error:', error);
      return res.status(500).json({ ok: false, error: 'Failed to get onboarding' });
    }
  });

  // ==========================================================================
  // POST /api/v1/programs/onboarding/start
  // Start onboarding program
  // ==========================================================================
  router.post('/onboarding/start', async (req: Request, res: Response) => {
    try {
      const userId = req.body.userId || req.headers['x-shopify-customer-id'];

      if (!userId) {
        return res.status(400).json({ ok: false, error: 'userId required' });
      }

      // Ensure onboarding program exists in DB
      let programs = await programsDB.listPrograms('onboarding');
      let onboardingProgram = programs[0];

      if (!onboardingProgram) {
        // Create it
        onboardingProgram = await programsDB.createProgram(ONBOARDING_PROGRAM);
      }

      // Enroll user
      const enrollment = await programsDB.enrollUser(userId, onboardingProgram.id);

      return res.json({
        ok: true,
        data: {
          enrollment,
          current_day: ONBOARDING_PROGRAM.days![0],
        },
      });
    } catch (error) {
      console.error('[Programs] Start onboarding error:', error);
      return res.status(500).json({ ok: false, error: 'Failed to start onboarding' });
    }
  });

  // ==========================================================================
  // POST /api/v1/programs/onboarding/:day/complete
  // Complete a task in onboarding
  // ==========================================================================
  router.post('/onboarding/:day/complete', async (req: Request, res: Response) => {
    try {
      const userId = req.body.userId || req.headers['x-shopify-customer-id'];
      const day = parseInt(req.params.day);
      const { taskId, responseData, quizAnswers, timeSpentSeconds } = req.body;

      if (!userId) {
        return res.status(400).json({ ok: false, error: 'userId required' });
      }

      if (!taskId) {
        return res.status(400).json({ ok: false, error: 'taskId required' });
      }

      // Get user's enrollment
      const enrollments = await programsDB.getUserEnrollments(userId);
      const enrollment = enrollments.find(e => e.status === 'active');

      if (!enrollment) {
        return res.status(404).json({ ok: false, error: 'No active enrollment' });
      }

      // Process quiz if applicable
      let quizScore: number | undefined;
      let quizPassed: boolean | undefined;

      if (quizAnswers) {
        // Find task to check answers
        const dayDef = ONBOARDING_PROGRAM.days![day - 1];
        const task = dayDef?.tasks.find(t => t.id === taskId);

        if (task?.content.type === 'quiz') {
          const quizContent = task.content as any;
          let correct = 0;
          quizContent.questions.forEach((q: any, i: number) => {
            if (quizAnswers[i] === q.correct_index) correct++;
          });
          quizScore = Math.round((correct / quizContent.questions.length) * 100);
          quizPassed = quizScore >= quizContent.passing_score;
        }
      }

      // Complete the task
      const result = await programsDB.completeTask(
        enrollment.id,
        taskId,
        day,
        responseData as TaskResponseData,
        quizScore,
        quizPassed,
        timeSpentSeconds
      );

      // Check if day is complete
      const dayProgress = await programsDB.getDayProgress(enrollment.id, day);
      const dayDef = ONBOARDING_PROGRAM.days![day - 1];
      const requiredTasks = dayDef.tasks.filter(t => t.required).length;
      const dayComplete = (dayProgress?.tasks_completed || 0) >= requiredTasks;

      if (dayComplete && dayProgress?.status !== 'completed') {
        await programsDB.completeDay(enrollment.id, day);

        // Unlock next day if exists
        if (day < 7) {
          await programsDB.initializeDayProgress(
            enrollment.id,
            day + 1,
            ONBOARDING_PROGRAM.days![day]
          );
        }
      }

      // Check if program is complete
      const updatedEnrollment = await programsDB.getEnrollment(enrollment.id);
      const programComplete = updatedEnrollment!.days_completed >= 7;

      if (programComplete) {
        await programsDB.updateEnrollmentStatus(enrollment.id, 'completed');
      }

      const response: TaskCompleteResponse = {
        success: true,
        points_awarded: result.pointsAwarded,
        new_total_points: (updatedEnrollment?.points_earned || 0) + result.pointsAwarded,
        streak_updated: dayComplete,
        new_streak: updatedEnrollment?.streak_days || 0,
        day_completed: dayComplete,
        program_completed: programComplete,
        unlocked_rewards: programComplete ? ['full_meal_plans', 'coach_chat'] : undefined,
      };

      return res.json({ ok: true, data: response });
    } catch (error) {
      console.error('[Programs] Complete task error:', error);
      return res.status(500).json({ ok: false, error: 'Failed to complete task' });
    }
  });

  // ==========================================================================
  // GET /api/v1/programs/available
  // List all available programs
  // ==========================================================================
  router.get('/available', async (req: Request, res: Response) => {
    try {
      const userId = req.query.userId as string || req.headers['x-shopify-customer-id'] as string;
      const category = req.query.category as string;
      const difficulty = req.query.difficulty as string;

      // Build query
      let query = `
        SELECT
          p.id,
          p.type,
          p.name,
          p.slug,
          p.description,
          p.category,
          p.difficulty,
          p.duration_days,
          p.is_default_onboarding,
          p.target_audience,
          p.learning_objectives,
          p.methodology,
          p.estimated_daily_minutes,
          p.thumbnail_url,
          p.coach_name,
          p.created_at
        FROM hc_programs p
        WHERE p.is_active = true
      `;
      const params: any[] = [];
      let paramIndex = 1;

      if (category) {
        query += ` AND p.category = $${paramIndex}`;
        params.push(category);
        paramIndex++;
      }

      if (difficulty) {
        query += ` AND p.difficulty = $${paramIndex}`;
        params.push(difficulty);
        paramIndex++;
      }

      query += ` ORDER BY p.is_default_onboarding DESC, p.created_at ASC`;

      const programsResult = await pool.query(query, params);

      // Get task counts and user enrollment status for each program
      const programs = await Promise.all(programsResult.rows.map(async (program) => {
        // Get task summary
        const taskSummary = await pool.query(`
          SELECT
            COUNT(*) as total_tasks,
            SUM(points_value) as total_points,
            SUM(estimated_minutes) as total_minutes
          FROM hc_tasks
          WHERE program_id = $1
        `, [program.id]);

        const summary = taskSummary.rows[0];

        // Check user enrollment if userId provided
        let enrollment = null;
        if (userId) {
          const enrollmentResult = await pool.query(`
            SELECT id, status, tasks_completed, points_earned, completion_rate
            FROM hc_program_enrollments
            WHERE user_id = $1 AND program_id = $2
          `, [userId, program.id]);

          if (enrollmentResult.rows.length > 0) {
            enrollment = enrollmentResult.rows[0];
          }
        }

        return {
          id: program.id,
          type: program.type,
          name: program.name,
          slug: program.slug,
          description: program.description,
          category: program.category,
          difficulty: program.difficulty,
          duration_days: program.duration_days,
          is_default_onboarding: program.is_default_onboarding,
          target_audience: program.target_audience || [],
          learning_objectives: program.learning_objectives || [],
          methodology: program.methodology,
          estimated_daily_minutes: program.estimated_daily_minutes,
          thumbnail_url: program.thumbnail_url,
          coach_name: program.coach_name,
          total_tasks: parseInt(summary.total_tasks) || 0,
          total_points: parseInt(summary.total_points) || 0,
          total_estimated_minutes: parseInt(summary.total_minutes) || 0,
          user_enrollment: enrollment,
        };
      }));

      // Separate into categories
      const onboarding = programs.filter(p => p.is_default_onboarding || p.category === 'onboarding');
      const other = programs.filter(p => !p.is_default_onboarding && p.category !== 'onboarding');

      // Get unique categories and difficulties for filtering
      const categories = [...new Set(programs.map(p => p.category).filter(Boolean))];
      const difficulties = [...new Set(programs.map(p => p.difficulty).filter(Boolean))];

      return res.json({
        ok: true,
        data: {
          programs,
          onboarding,
          other,
          filters: {
            categories,
            difficulties,
          },
          total: programs.length,
        },
      });
    } catch (error) {
      console.error('[Programs] List available error:', error);
      return res.status(500).json({ ok: false, error: 'Failed to list programs' });
    }
  });

  // ==========================================================================
  // PATCH /api/v1/programs/enrollments/:enrollmentId
  // Pause or resume an enrollment
  // ==========================================================================
  router.patch('/enrollments/:enrollmentId', async (req: Request, res: Response) => {
    try {
      const { enrollmentId } = req.params;
      const userId = req.body.userId || req.headers['x-shopify-customer-id'] as string;
      const { action } = req.body; // 'pause' or 'resume'

      if (!userId) {
        return res.status(400).json({ ok: false, error: 'userId required' });
      }

      if (!action || !['pause', 'resume'].includes(action)) {
        return res.status(400).json({ ok: false, error: 'action required (pause or resume)' });
      }

      // Get enrollment and verify ownership
      const enrollmentResult = await pool.query(`
        SELECT id, status, paused_at, program_id
        FROM hc_program_enrollments
        WHERE id = $1 AND user_id = $2
      `, [enrollmentId, userId]);

      if (enrollmentResult.rows.length === 0) {
        return res.status(404).json({ ok: false, error: 'Enrollment not found' });
      }

      const enrollment = enrollmentResult.rows[0];

      // Validate action based on current status
      if (action === 'pause') {
        if (enrollment.status === 'paused') {
          return res.status(400).json({ ok: false, error: 'Enrollment is already paused' });
        }
        if (enrollment.status === 'completed') {
          return res.status(400).json({ ok: false, error: 'Cannot pause a completed enrollment' });
        }

        // Pause the enrollment
        await pool.query(`
          UPDATE hc_program_enrollments
          SET status = 'paused', paused_at = NOW(), updated_at = NOW()
          WHERE id = $1
        `, [enrollmentId]);

        return res.json({
          ok: true,
          data: {
            enrollment_id: enrollmentId,
            status: 'paused',
            paused_at: new Date().toISOString(),
            message: 'Enrollment paused successfully',
          },
        });
      }

      if (action === 'resume') {
        if (enrollment.status === 'active') {
          return res.status(400).json({ ok: false, error: 'Enrollment is already active' });
        }
        if (enrollment.status === 'completed') {
          return res.status(400).json({ ok: false, error: 'Cannot resume a completed enrollment. Use re-enroll instead.' });
        }

        // Resume the enrollment
        await pool.query(`
          UPDATE hc_program_enrollments
          SET status = 'active', paused_at = NULL, updated_at = NOW()
          WHERE id = $1
        `, [enrollmentId]);

        return res.json({
          ok: true,
          data: {
            enrollment_id: enrollmentId,
            status: 'active',
            resumed_at: new Date().toISOString(),
            message: 'Enrollment resumed successfully',
          },
        });
      }
    } catch (error) {
      console.error('[Programs] Update enrollment error:', error);
      return res.status(500).json({ ok: false, error: 'Failed to update enrollment' });
    }
  });

  // ==========================================================================
  // GET /api/v1/programs/enrollments
  // List all enrollments for a user
  // ==========================================================================
  router.get('/enrollments', async (req: Request, res: Response) => {
    try {
      const userId = req.query.userId as string || req.headers['x-shopify-customer-id'] as string;

      if (!userId) {
        return res.status(400).json({ ok: false, error: 'userId required' });
      }

      // Get all enrollments with program details
      const enrollmentsResult = await pool.query(`
        SELECT
          e.id as enrollment_id,
          e.status,
          e.started_at,
          e.completed_at,
          e.current_day,
          e.tasks_completed,
          e.total_tasks,
          e.points_earned,
          e.streak_days,
          e.longest_streak,
          e.total_time_spent_minutes,
          p.id as program_id,
          p.name as program_name,
          p.slug as program_slug,
          p.description as program_description,
          p.duration_days,
          p.difficulty,
          p.category,
          p.thumbnail_url,
          p.estimated_daily_minutes
        FROM hc_program_enrollments e
        JOIN hc_programs p ON e.program_id = p.id
        WHERE e.user_id = $1
        ORDER BY e.started_at DESC
      `, [userId]);

      // Calculate progress for each enrollment
      const enrollments = await Promise.all(enrollmentsResult.rows.map(async (row) => {
        // Get completed tasks by day
        const completedResult = await pool.query(`
          SELECT day, COUNT(*) as count
          FROM hc_program_task_responses
          WHERE enrollment_id = $1 AND completed = true
          GROUP BY day
        `, [row.enrollment_id]);

        const completedByDay: Record<number, number> = {};
        completedResult.rows.forEach((r: any) => {
          completedByDay[r.day] = parseInt(r.count);
        });

        // Calculate completion percentage
        const completionPercentage = row.total_tasks > 0
          ? Math.round((row.tasks_completed / row.total_tasks) * 100)
          : 0;

        // Calculate days completed (days where all 4 tasks are done)
        const daysCompleted = Object.values(completedByDay).filter(count => count >= 4).length;

        return {
          enrollment_id: row.enrollment_id,
          status: row.status,
          started_at: row.started_at,
          completed_at: row.completed_at,
          current_day: row.current_day,
          tasks_completed: row.tasks_completed,
          total_tasks: row.total_tasks,
          completion_percentage: completionPercentage,
          days_completed: daysCompleted,
          points_earned: row.points_earned,
          streak_days: row.streak_days,
          longest_streak: row.longest_streak,
          total_time_spent_minutes: row.total_time_spent_minutes,
          program: {
            id: row.program_id,
            name: row.program_name,
            slug: row.program_slug,
            description: row.program_description,
            duration_days: row.duration_days,
            difficulty: row.difficulty,
            category: row.category,
            thumbnail_url: row.thumbnail_url,
            estimated_daily_minutes: row.estimated_daily_minutes,
          },
        };
      }));

      // Separate by status
      const active = enrollments.filter(e => e.status === 'active');
      const completed = enrollments.filter(e => e.status === 'completed');
      const paused = enrollments.filter(e => e.status === 'paused');

      // Calculate totals
      const totalPoints = enrollments.reduce((sum, e) => sum + (e.points_earned || 0), 0);
      const totalTasksCompleted = enrollments.reduce((sum, e) => sum + (e.tasks_completed || 0), 0);
      const programsCompleted = completed.length;

      return res.json({
        ok: true,
        data: {
          enrollments,
          active,
          completed,
          paused,
          summary: {
            total_enrollments: enrollments.length,
            active_count: active.length,
            completed_count: completed.length,
            paused_count: paused.length,
            total_points: totalPoints,
            total_tasks_completed: totalTasksCompleted,
            programs_completed: programsCompleted,
          },
        },
      });
    } catch (error) {
      console.error('[Programs] List enrollments error:', error);
      return res.status(500).json({ ok: false, error: 'Failed to list enrollments' });
    }
  });

  // ==========================================================================
  // POST /api/v1/programs/enroll
  // Enroll user in a program (by program_id or slug)
  // ==========================================================================
  router.post('/enroll', async (req: Request, res: Response) => {
    try {
      const userId = req.body.userId || req.headers['x-shopify-customer-id'] as string;
      const { program_id, slug } = req.body;

      if (!userId) {
        return res.status(400).json({ ok: false, error: 'userId required' });
      }

      if (!program_id && !slug) {
        return res.status(400).json({ ok: false, error: 'program_id or slug required' });
      }

      // Get program by ID or slug
      let programResult;
      if (program_id) {
        programResult = await pool.query(
          `SELECT id, name, slug, duration_days FROM hc_programs WHERE id = $1`,
          [program_id]
        );
      } else {
        programResult = await pool.query(
          `SELECT id, name, slug, duration_days FROM hc_programs WHERE slug = $1`,
          [slug]
        );
      }

      if (programResult.rows.length === 0) {
        return res.status(404).json({ ok: false, error: 'Program not found' });
      }

      const program = programResult.rows[0];

      // Check if already enrolled
      const existingEnrollment = await pool.query(`
        SELECT id, status, started_at, completed_at
        FROM hc_program_enrollments
        WHERE user_id = $1 AND program_id = $2
      `, [userId, program.id]);

      if (existingEnrollment.rows.length > 0) {
        const existing = existingEnrollment.rows[0];

        // If completed, allow re-enrollment
        if (existing.status === 'completed') {
          await pool.query(`
            UPDATE hc_program_enrollments
            SET status = 'active', started_at = NOW(), completed_at = NULL,
                current_day = 1, tasks_completed = 0, points_earned = 0,
                streak_days = 0, updated_at = NOW()
            WHERE id = $1
            RETURNING *
          `, [existing.id]);

          // Clear previous task responses
          await pool.query(`
            DELETE FROM hc_program_task_responses WHERE enrollment_id = $1
          `, [existing.id]);

          return res.json({
            ok: true,
            data: {
              enrollment_id: existing.id,
              program_id: program.id,
              program_name: program.name,
              status: 'active',
              re_enrolled: true,
              message: 'Re-enrolled in program',
            },
          });
        }

        // Already actively enrolled
        return res.json({
          ok: true,
          data: {
            enrollment_id: existing.id,
            program_id: program.id,
            program_name: program.name,
            status: existing.status,
            already_enrolled: true,
            started_at: existing.started_at,
            message: 'Already enrolled in this program',
          },
        });
      }

      // Get total tasks for the program
      const taskCountResult = await pool.query(
        `SELECT COUNT(*) as count FROM hc_tasks WHERE program_id = $1`,
        [program.id]
      );
      const totalTasks = parseInt(taskCountResult.rows[0].count) || 0;

      // Create new enrollment
      const enrollmentResult = await pool.query(`
        INSERT INTO hc_program_enrollments (
          user_id, program_id, status, current_day, total_tasks,
          tasks_completed, points_earned, streak_days
        ) VALUES ($1, $2, 'active', 1, $3, 0, 0, 0)
        RETURNING id, status, started_at, current_day
      `, [userId, program.id, totalTasks]);

      const enrollment = enrollmentResult.rows[0];

      return res.status(201).json({
        ok: true,
        data: {
          enrollment_id: enrollment.id,
          program_id: program.id,
          program_name: program.name,
          program_slug: program.slug,
          status: enrollment.status,
          started_at: enrollment.started_at,
          current_day: enrollment.current_day,
          total_tasks: totalTasks,
          duration_days: program.duration_days,
          message: 'Successfully enrolled in program',
        },
      });
    } catch (error) {
      console.error('[Programs] Enroll error:', error);
      return res.status(500).json({ ok: false, error: 'Failed to enroll in program' });
    }
  });

  // ==========================================================================
  // GET /api/v1/programs/by-slug/:slug
  // Get program by slug (e.g., "nutrition-foundations-7day")
  // ==========================================================================
  router.get('/by-slug/:slug', async (req: Request, res: Response) => {
    try {
      const { slug } = req.params;
      const userId = req.query.userId as string || req.headers['x-shopify-customer-id'] as string;

      // Get program by slug
      const programResult = await pool.query(`
        SELECT
          id, type, name, slug, description, category, difficulty,
          duration_days, is_default_onboarding, is_active,
          target_audience, prerequisites, learning_objectives,
          methodology, estimated_daily_minutes, thumbnail_url,
          coach_name, created_at
        FROM hc_programs
        WHERE slug = $1
      `, [slug]);

      if (programResult.rows.length === 0) {
        return res.status(404).json({
          ok: false,
          error: 'Program not found',
        });
      }

      const program = programResult.rows[0];

      // Parse JSON fields
      program.target_audience = program.target_audience || [];
      program.prerequisites = program.prerequisites || [];
      program.learning_objectives = program.learning_objectives || [];

      // Get task counts by day
      const taskCountsResult = await pool.query(`
        SELECT day_number, COUNT(*) as task_count,
               SUM(points_value) as total_points,
               SUM(estimated_minutes) as estimated_minutes
        FROM hc_tasks
        WHERE program_id = $1
        GROUP BY day_number
        ORDER BY day_number
      `, [program.id]);

      const days = taskCountsResult.rows.map(row => ({
        day: row.day_number,
        task_count: parseInt(row.task_count),
        total_points: parseInt(row.total_points) || 0,
        estimated_minutes: parseInt(row.estimated_minutes) || 0,
      }));

      // Get user enrollment status if userId provided
      let enrollment = null;
      let userProgress = null;

      if (userId) {
        const enrollmentResult = await pool.query(`
          SELECT id, status, started_at, completed_at, current_day,
                 tasks_completed, points_earned, streak_days
          FROM hc_program_enrollments
          WHERE user_id = $1 AND program_id = $2
        `, [userId, program.id]);

        if (enrollmentResult.rows.length > 0) {
          enrollment = enrollmentResult.rows[0];

          // Get completed task IDs
          const completedResult = await pool.query(`
            SELECT task_id, day FROM hc_program_task_responses
            WHERE enrollment_id = $1 AND completed = true
          `, [enrollment.id]);

          userProgress = {
            completed_task_ids: completedResult.rows.map(r => r.task_id),
            completed_by_day: completedResult.rows.reduce((acc: Record<number, string[]>, r: any) => {
              if (!acc[r.day]) acc[r.day] = [];
              acc[r.day].push(r.task_id);
              return acc;
            }, {}),
          };
        }
      }

      // Calculate totals
      const totalTasks = days.reduce((sum, d) => sum + d.task_count, 0);
      const totalPoints = days.reduce((sum, d) => sum + d.total_points, 0);
      const totalMinutes = days.reduce((sum, d) => sum + d.estimated_minutes, 0);

      return res.json({
        ok: true,
        data: {
          program: {
            ...program,
            total_tasks: totalTasks,
            total_points: totalPoints,
            total_estimated_minutes: totalMinutes,
          },
          days,
          enrollment,
          user_progress: userProgress,
        },
      });
    } catch (error) {
      console.error('[Programs] Get by slug error:', error);
      return res.status(500).json({ ok: false, error: 'Failed to get program' });
    }
  });

  // ==========================================================================
  // GET /api/v1/programs/:programId/days/:day/tasks
  // Get tasks for a specific day of a program
  // ==========================================================================
  router.get('/:programId/days/:day/tasks', async (req: Request, res: Response) => {
    try {
      const { programId, day } = req.params;
      const dayNumber = parseInt(day);

      if (isNaN(dayNumber) || dayNumber < 1) {
        return res.status(400).json({ ok: false, error: 'Invalid day number' });
      }

      // Get tasks from hc_tasks table
      const result = await pool.query(`
        SELECT
          id,
          task_order,
          day_number,
          task_type,
          title,
          content,
          points_value,
          action_type,
          quiz_questions,
          estimated_minutes
        FROM hc_tasks
        WHERE program_id = $1 AND day_number = $2
        ORDER BY task_order ASC
      `, [programId, dayNumber]);

      if (result.rows.length === 0) {
        return res.status(404).json({
          ok: false,
          error: 'No tasks found for this day'
        });
      }

      // Parse quiz_questions JSON if present
      const tasks = result.rows.map(task => ({
        ...task,
        quiz_questions: task.quiz_questions ?
          (typeof task.quiz_questions === 'string' ?
            JSON.parse(task.quiz_questions) : task.quiz_questions) : null
      }));

      return res.json({
        ok: true,
        data: {
          program_id: programId,
          day: dayNumber,
          tasks,
          total_points: tasks.reduce((sum: number, t: any) => sum + (t.points_value || 0), 0),
          estimated_minutes: tasks.reduce((sum: number, t: any) => sum + (t.estimated_minutes || 0), 0),
        },
      });
    } catch (error) {
      console.error('[Programs] Get day tasks error:', error);
      return res.status(500).json({ ok: false, error: 'Failed to get tasks' });
    }
  });

  // ==========================================================================
  // GET /api/v1/programs/:programId/tasks
  // Get all tasks for a program (organized by day)
  // ==========================================================================
  router.get('/:programId/tasks', async (req: Request, res: Response) => {
    try {
      const { programId } = req.params;

      // Get all tasks for the program
      const result = await pool.query(`
        SELECT
          id,
          task_order,
          day_number,
          task_type,
          title,
          content,
          points_value,
          action_type,
          quiz_questions,
          estimated_minutes
        FROM hc_tasks
        WHERE program_id = $1
        ORDER BY day_number ASC, task_order ASC
      `, [programId]);

      // Parse quiz_questions and organize by day
      const tasksByDay: Record<number, any[]> = {};

      for (const task of result.rows) {
        const dayNum = task.day_number;
        if (!tasksByDay[dayNum]) {
          tasksByDay[dayNum] = [];
        }
        tasksByDay[dayNum].push({
          ...task,
          quiz_questions: task.quiz_questions ?
            (typeof task.quiz_questions === 'string' ?
              JSON.parse(task.quiz_questions) : task.quiz_questions) : null
        });
      }

      // Convert to array format
      const days = Object.entries(tasksByDay).map(([day, tasks]) => ({
        day: parseInt(day),
        tasks,
        total_points: tasks.reduce((sum: number, t: any) => sum + (t.points_value || 0), 0),
        estimated_minutes: tasks.reduce((sum: number, t: any) => sum + (t.estimated_minutes || 0), 0),
      }));

      return res.json({
        ok: true,
        data: {
          program_id: programId,
          total_days: days.length,
          total_tasks: result.rows.length,
          days,
        },
      });
    } catch (error) {
      console.error('[Programs] Get all tasks error:', error);
      return res.status(500).json({ ok: false, error: 'Failed to get tasks' });
    }
  });

  // ==========================================================================
  // POST /api/v1/programs/:programId/tasks/:taskId/complete
  // Mark a task as complete
  // ==========================================================================
  router.post('/:programId/tasks/:taskId/complete', async (req: Request, res: Response) => {
    try {
      const { programId, taskId } = req.params;
      const userId = req.body.userId || req.headers['x-shopify-customer-id'] as string;

      if (!userId) {
        return res.status(400).json({ ok: false, error: 'userId required' });
      }

      const {
        response_text,      // For reflections/journals
        quiz_answers,       // For quizzes: array of selected answer indices
        time_spent_seconds, // How long spent on task
      } = req.body;

      // Get the task to validate and get points
      const taskResult = await pool.query(`
        SELECT id, task_type, title, points_value, quiz_questions, day_number
        FROM hc_tasks
        WHERE id = $1 AND program_id = $2
      `, [taskId, programId]);

      if (taskResult.rows.length === 0) {
        return res.status(404).json({ ok: false, error: 'Task not found' });
      }

      const task = taskResult.rows[0];

      // Process quiz if applicable
      let quizScore: number | null = null;
      let quizPassed: boolean | null = null;

      if (task.task_type === 'quiz' && quiz_answers && task.quiz_questions) {
        const questions = typeof task.quiz_questions === 'string'
          ? JSON.parse(task.quiz_questions)
          : task.quiz_questions;

        let correct = 0;
        questions.forEach((q: any, i: number) => {
          if (quiz_answers[i] === q.correct) correct++;
        });

        quizScore = Math.round((correct / questions.length) * 100);
        quizPassed = quizScore >= 70; // 70% passing threshold
      }

      // Get or create enrollment
      let enrollmentResult = await pool.query(`
        SELECT id, points_earned FROM hc_program_enrollments
        WHERE user_id = $1 AND program_id = $2
      `, [userId, programId]);

      let enrollmentId: string;
      let currentPoints: number;

      if (enrollmentResult.rows.length === 0) {
        // Auto-enroll user
        const newEnrollment = await pool.query(`
          INSERT INTO hc_program_enrollments (user_id, program_id, status, current_day, total_tasks)
          VALUES ($1, $2, 'active', $3, 28)
          RETURNING id, points_earned
        `, [userId, programId, task.day_number]);

        enrollmentId = newEnrollment.rows[0].id;
        currentPoints = 0;
      } else {
        enrollmentId = enrollmentResult.rows[0].id;
        currentPoints = enrollmentResult.rows[0].points_earned || 0;
      }

      // Check if already completed
      const existingCompletion = await pool.query(`
        SELECT id FROM hc_program_task_responses
        WHERE enrollment_id = $1 AND task_id = $2 AND completed = true
      `, [enrollmentId, taskId]);

      if (existingCompletion.rows.length > 0) {
        return res.json({
          ok: true,
          data: {
            already_completed: true,
            message: 'Task was already completed',
            points_awarded: 0,
            total_points: currentPoints,
          },
        });
      }

      // Record the task completion
      // Build response_data JSON
      const responseData = {
        text: response_text || null,
        quiz_answers: quiz_answers || null,
      };

      await pool.query(`
        INSERT INTO hc_program_task_responses (
          enrollment_id, task_id, day, completed,
          response_data, quiz_score, quiz_passed, time_spent_seconds, completed_at, points_awarded
        ) VALUES ($1, $2, $3, true, $4, $5, $6, $7, NOW(), $8)
        ON CONFLICT (enrollment_id, task_id) DO UPDATE SET
          completed = true,
          response_data = COALESCE(EXCLUDED.response_data, hc_program_task_responses.response_data),
          quiz_score = COALESCE(EXCLUDED.quiz_score, hc_program_task_responses.quiz_score),
          quiz_passed = COALESCE(EXCLUDED.quiz_passed, hc_program_task_responses.quiz_passed),
          time_spent_seconds = COALESCE(EXCLUDED.time_spent_seconds, hc_program_task_responses.time_spent_seconds),
          points_awarded = COALESCE(EXCLUDED.points_awarded, hc_program_task_responses.points_awarded),
          completed_at = NOW()
      `, [
        enrollmentId,
        taskId,
        task.day_number,
        JSON.stringify(responseData),
        quizScore,
        quizPassed,
        time_spent_seconds || null,
        task.points_value || 0,
      ]);

      // Award points
      const pointsAwarded = task.points_value || 0;
      const newTotalPoints = currentPoints + pointsAwarded;

      // Calculate streak
      const streakResult = await pool.query(`
        SELECT
          streak_days,
          longest_streak,
          last_activity_date
        FROM hc_program_enrollments
        WHERE id = $1
      `, [enrollmentId]);

      let currentStreak = streakResult.rows[0]?.streak_days || 0;
      let longestStreak = streakResult.rows[0]?.longest_streak || 0;
      const lastActivityDate = streakResult.rows[0]?.last_activity_date;

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      let streakUpdated = false;
      let streakBroken = false;

      if (lastActivityDate) {
        const lastDate = new Date(lastActivityDate);
        lastDate.setHours(0, 0, 0, 0);

        if (lastDate.getTime() === today.getTime()) {
          // Already completed something today - streak stays the same
          streakUpdated = false;
        } else if (lastDate.getTime() === yesterday.getTime()) {
          // Completed yesterday - increment streak
          currentStreak += 1;
          streakUpdated = true;
        } else {
          // Missed a day - reset streak to 1
          streakBroken = currentStreak > 0;
          currentStreak = 1;
          streakUpdated = true;
        }
      } else {
        // First activity ever - start streak at 1
        currentStreak = 1;
        streakUpdated = true;
      }

      // Update longest streak if current exceeds it
      if (currentStreak > longestStreak) {
        longestStreak = currentStreak;
      }

      // Update enrollment stats with streak
      await pool.query(`
        UPDATE hc_program_enrollments
        SET
          points_earned = $1,
          tasks_completed = tasks_completed + 1,
          total_time_spent_minutes = total_time_spent_minutes + $2,
          streak_days = $3,
          longest_streak = $4,
          last_activity_date = CURRENT_DATE,
          updated_at = NOW()
        WHERE id = $5
      `, [newTotalPoints, Math.ceil((time_spent_seconds || 0) / 60), currentStreak, longestStreak, enrollmentId]);

      // Check if day is complete
      const dayTasksResult = await pool.query(`
        SELECT COUNT(*) as total FROM hc_tasks WHERE program_id = $1 AND day_number = $2
      `, [programId, task.day_number]);

      const completedTasksResult = await pool.query(`
        SELECT COUNT(*) as completed FROM hc_program_task_responses
        WHERE enrollment_id = $1 AND day = $2 AND completed = true
      `, [enrollmentId, task.day_number]);

      const totalDayTasks = parseInt(dayTasksResult.rows[0].total);
      const completedDayTasks = parseInt(completedTasksResult.rows[0].completed);
      const dayComplete = completedDayTasks >= totalDayTasks;

      // Check if program is complete (all 7 days)
      const allCompletedResult = await pool.query(`
        SELECT COUNT(DISTINCT day) as days_done FROM hc_program_task_responses
        WHERE enrollment_id = $1 AND completed = true
      `, [enrollmentId]);

      // Count days where ALL tasks are complete
      const programComplete = parseInt(allCompletedResult.rows[0].days_done) >= 7 && dayComplete;

      if (programComplete) {
        await pool.query(`
          UPDATE hc_program_enrollments
          SET status = 'completed', completed_at = NOW()
          WHERE id = $1
        `, [enrollmentId]);
      }

      return res.json({
        ok: true,
        data: {
          task_id: taskId,
          completed: true,
          points_awarded: pointsAwarded,
          total_points: newTotalPoints,
          quiz_score: quizScore,
          quiz_passed: quizPassed,
          day_progress: {
            day: task.day_number,
            tasks_completed: completedDayTasks,
            total_tasks: totalDayTasks,
            day_complete: dayComplete,
          },
          streak: {
            current: currentStreak,
            longest: longestStreak,
            updated: streakUpdated,
            broken: streakBroken,
          },
          program_complete: programComplete,
        },
      });
    } catch (error) {
      console.error('[Programs] Complete task error:', error);
      return res.status(500).json({ ok: false, error: 'Failed to complete task' });
    }
  });

  // ==========================================================================
  // GET /api/v1/programs/:programId/progress
  // Get user's progress on a program
  // ==========================================================================
  router.get('/:programId/progress', async (req: Request, res: Response) => {
    try {
      const { programId } = req.params;
      const userId = req.query.userId as string || req.headers['x-shopify-customer-id'] as string;

      if (!userId) {
        return res.status(400).json({ ok: false, error: 'userId required' });
      }

      // Get enrollment
      const enrollmentResult = await pool.query(`
        SELECT * FROM hc_program_enrollments
        WHERE user_id = $1 AND program_id = $2
      `, [userId, programId]);

      if (enrollmentResult.rows.length === 0) {
        return res.json({
          ok: true,
          data: {
            enrolled: false,
            message: 'User is not enrolled in this program',
          },
        });
      }

      const enrollment = enrollmentResult.rows[0];

      // Get completed tasks
      const completedTasksResult = await pool.query(`
        SELECT task_id, day, completed_at, quiz_score, quiz_passed, response_data
        FROM hc_program_task_responses
        WHERE enrollment_id = $1 AND completed = true
        ORDER BY day, completed_at
      `, [enrollment.id]);

      // Group by day
      const progressByDay: Record<number, any[]> = {};
      for (const task of completedTasksResult.rows) {
        if (!progressByDay[task.day]) {
          progressByDay[task.day] = [];
        }
        progressByDay[task.day].push(task);
      }

      // Get total tasks per day
      const totalTasksResult = await pool.query(`
        SELECT day_number, COUNT(*) as count
        FROM hc_tasks
        WHERE program_id = $1
        GROUP BY day_number
      `, [programId]);

      const totalTasksByDay: Record<number, number> = {};
      for (const row of totalTasksResult.rows) {
        totalTasksByDay[row.day_number] = parseInt(row.count);
      }

      // Build day progress
      const days = [];
      for (let day = 1; day <= 7; day++) {
        const completed = progressByDay[day] || [];
        const total = totalTasksByDay[day] || 4;
        days.push({
          day,
          tasks_completed: completed.length,
          total_tasks: total,
          is_complete: completed.length >= total,
          completed_task_ids: completed.map((t: any) => t.task_id),
        });
      }

      return res.json({
        ok: true,
        data: {
          enrolled: true,
          enrollment: {
            id: enrollment.id,
            status: enrollment.status,
            started_at: enrollment.started_at,
            completed_at: enrollment.completed_at,
            points_earned: enrollment.points_earned,
            tasks_completed: enrollment.tasks_completed,
            streak_days: enrollment.streak_days,
          },
          days,
          overall: {
            total_tasks: 28,
            completed_tasks: completedTasksResult.rows.length,
            completion_percentage: Math.round((completedTasksResult.rows.length / 28) * 100),
          },
        },
      });
    } catch (error) {
      console.error('[Programs] Get progress error:', error);
      return res.status(500).json({ ok: false, error: 'Failed to get progress' });
    }
  });

  // ==========================================================================
  // GET /api/v1/programs/:programId
  // Get program details
  // ==========================================================================
  router.get('/:programId', async (req: Request, res: Response) => {
    try {
      const program = await programsDB.getProgram(req.params.programId);

      if (!program) {
        return res.status(404).json({ ok: false, error: 'Program not found' });
      }

      return res.json({ ok: true, data: program });
    } catch (error) {
      console.error('[Programs] Get program error:', error);
      return res.status(500).json({ ok: false, error: 'Failed to get program' });
    }
  });

  // ==========================================================================
  // POST /api/v1/programs/:programId/enroll
  // Enroll in a program
  // ==========================================================================
  router.post('/:programId/enroll', async (req: Request, res: Response) => {
    try {
      const userId = req.body.userId || req.headers['x-shopify-customer-id'];

      if (!userId) {
        return res.status(400).json({ ok: false, error: 'userId required' });
      }

      const enrollment = await programsDB.enrollUser(userId, req.params.programId);

      return res.json({ ok: true, data: enrollment });
    } catch (error: any) {
      console.error('[Programs] Enroll error:', error);
      return res.status(500).json({ ok: false, error: error.message || 'Failed to enroll' });
    }
  });

  // ==========================================================================
  // Habits Routes
  // ==========================================================================

  // GET /api/v1/programs/habits
  router.get('/habits', async (req: Request, res: Response) => {
    try {
      const userId = req.query.userId as string || req.headers['x-shopify-customer-id'] as string;

      if (!userId) {
        return res.status(400).json({ ok: false, error: 'userId required' });
      }

      const habits = await programsDB.getUserHabits(userId);

      return res.json({ ok: true, data: habits });
    } catch (error) {
      console.error('[Programs] Get habits error:', error);
      return res.status(500).json({ ok: false, error: 'Failed to get habits' });
    }
  });

  // POST /api/v1/programs/habits
  router.post('/habits', async (req: Request, res: Response) => {
    try {
      const userId = req.body.userId || req.headers['x-shopify-customer-id'];

      if (!userId) {
        return res.status(400).json({ ok: false, error: 'userId required' });
      }

      if (!req.body.habit_name) {
        return res.status(400).json({ ok: false, error: 'habit_name required' });
      }

      const habit = await programsDB.createHabit(userId, req.body);

      return res.json({ ok: true, data: habit });
    } catch (error) {
      console.error('[Programs] Create habit error:', error);
      return res.status(500).json({ ok: false, error: 'Failed to create habit' });
    }
  });

  // POST /api/v1/programs/habits/:habitId/complete
  router.post('/habits/:habitId/complete', async (req: Request, res: Response) => {
    try {
      const userId = req.body.userId || req.headers['x-shopify-customer-id'];

      if (!userId) {
        return res.status(400).json({ ok: false, error: 'userId required' });
      }

      const completion = await programsDB.completeHabit(
        req.params.habitId,
        userId,
        req.body.notes,
        req.body.mood_rating
      );

      return res.json({ ok: true, data: completion });
    } catch (error) {
      console.error('[Programs] Complete habit error:', error);
      return res.status(500).json({ ok: false, error: 'Failed to complete habit' });
    }
  });

  return router;
}

export default createProgramsRouter;
