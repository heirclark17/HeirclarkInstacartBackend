// src/routes/ai.ts
// Additional AI endpoints for workout plans and AI coach chat
// Meal plan endpoints are in mealPlan.ts (already mounted at /api/v1/ai)
import { Router, Request, Response } from 'express';
import { sendSuccess, sendError, sendServerError } from '../middleware/responseHelper';
import { rateLimitMiddleware } from '../middleware/rateLimiter';
import { authMiddleware } from '../middleware/auth';

// Import meal plan functions - defined at bottom of this file to avoid circular dependency
let generateMealPlanWithAI: any;
let addImagesToMealPlan: any;

export const aiExtraRouter = Router();

// Apply authentication
aiExtraRouter.use(authMiddleware());

// Rate limiting for AI endpoints (10 requests per minute for expensive operations)
const aiRateLimit = rateLimitMiddleware({
  windowMs: 60000,
  maxRequests: 10,
  message: 'Too many AI requests, please try again later',
});

// OpenAI configuration
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

// ============================================================================
// MEAL PLAN GENERATION WRAPPER
// ============================================================================

/**
 * POST /api/v1/ai/generate-meal-plan
 * Wrapper endpoint that forwards to the existing meal plan generation logic
 * Provides consistent interface expected by frontend
 */
aiExtraRouter.post('/generate-meal-plan', aiRateLimit, async (req: Request, res: Response) => {
  const { preferences, days = 7, shopifyCustomerId } = req.body;

  if (!preferences) {
    return sendError(res, 'Missing preferences object', 400);
  }

  // Transform frontend preferences to backend format
  const targets = {
    calories: preferences.calorieTarget || preferences.calories || 2000,
    protein: preferences.proteinTarget || preferences.protein || 150,
    carbs: preferences.carbsTarget || preferences.carbs || 200,
    fat: preferences.fatTarget || preferences.fat || 65,
  };

  const backendPreferences = {
    dietType: preferences.dietType || 'balanced',
    mealsPerDay: preferences.mealsPerDay || 3,
    allergies: preferences.allergies || [],
    cookingSkill: preferences.cookingSkill || 'intermediate',
    budgetTier: preferences.budgetTier,
    mealStyle: preferences.mealStyle,
    favoriteProteins: preferences.favoriteProteins || [],
    favoriteFruits: preferences.favoriteFruits || [],
    favoriteVegetables: preferences.favoriteVegetables || [],
    favoriteStarches: preferences.favoriteStarches || [],
    favoriteCuisines: preferences.favoriteCuisines || [],
    favoriteSnacks: preferences.favoriteSnacks || [],
    hatedFoods: preferences.hatedFoods || '',
    cheatDays: preferences.cheatDays || [],
    mealDiversity: preferences.mealDiversity,
  };

  try {
    console.log('[aiExtraRouter] Generating meal plan with AI');

    // Lazy load meal plan functions to avoid circular dependency
    if (!generateMealPlanWithAI) {
      const mealPlanModule = await import('./mealPlan');
      generateMealPlanWithAI = mealPlanModule.generateMealPlanWithAI;
      addImagesToMealPlan = mealPlanModule.addImagesToMealPlan;
    }

    // Generate the meal plan using existing logic
    let plan = await generateMealPlanWithAI(targets, backendPreferences);

    // Add images to the plan
    try {
      plan = await addImagesToMealPlan(plan);
    } catch (imgErr: any) {
      console.warn('[aiExtraRouter] Image fetch failed (continuing without images):', imgErr.message);
    }

    return res.status(200).json({ ok: true, plan });
  } catch (err: any) {
    console.error('[aiExtraRouter] Meal plan generation failed:', err);
    return sendServerError(res, err.message || 'Failed to generate meal plan');
  }
});

// ============================================================================
// WORKOUT PLAN GENERATION
// ============================================================================

interface WorkoutPlanPreferences {
  fitnessGoal: string; // 'strength' | 'endurance' | 'weight_loss' | 'muscle_gain' | 'general_fitness'
  experienceLevel: string; // 'beginner' | 'intermediate' | 'advanced'
  daysPerWeek: number; // 3-7
  sessionDuration: number; // minutes
  availableEquipment: string[]; // ['dumbbells', 'barbell', 'resistance_bands', 'bodyweight', 'gym', 'home']
  injuries?: string[];
  preferences?: string[];
}

/**
 * POST /api/v1/ai/generate-workout-plan
 * Generate AI-powered workout plan using GPT-4.1-mini
 */
aiExtraRouter.post('/generate-workout-plan', aiRateLimit, async (req: Request, res: Response) => {
  const { preferences, weeks = 4, shopifyCustomerId } = req.body;

  if (!preferences) {
    return sendError(res, 'Missing preferences object', 400);
  }

  if (!OPENAI_API_KEY) {
    return sendError(res, 'OpenAI API key not configured', 500);
  }

  const prefs = preferences as WorkoutPlanPreferences;
  const goal = prefs.fitnessGoal || 'general_fitness';
  const level = prefs.experienceLevel || 'beginner';
  const daysPerWeek = prefs.daysPerWeek || 3;
  const sessionMinutes = prefs.sessionDuration || 45;
  const equipment = prefs.availableEquipment || ['bodyweight'];
  const injuries = prefs.injuries || [];

  const systemPrompt = `You are a certified personal trainer creating workout programs. Generate a ${weeks}-week workout plan in this EXACT JSON format:

{
  "weeks": [
    {
      "weekNumber": 1,
      "focus": "Foundation Building",
      "workouts": [
        {
          "dayOfWeek": "Monday",
          "workoutType": "Full Body Strength",
          "duration": 45,
          "exercises": [
            {
              "name": "Barbell Squat",
              "sets": 3,
              "reps": "8-10",
              "rest": "90 seconds",
              "notes": "Focus on depth and form"
            }
          ]
        }
      ]
    }
  ],
  "progressionGuidelines": "Increase weight by 5% each week when completing all sets",
  "warmupRoutine": "5-10 minutes light cardio + dynamic stretching",
  "cooldownRoutine": "5-10 minutes static stretching"
}

REQUIREMENTS:
- Generate ${daysPerWeek} workouts per week
- Each workout should be ${sessionMinutes} minutes
- Goal: ${goal}
- Experience: ${level}
- Equipment: ${equipment.join(', ')}
${injuries.length > 0 ? `- AVOID exercises that aggravate: ${injuries.join(', ')}` : ''}
- Include 4-6 exercises per workout
- Specify sets, reps, and rest periods
- Add form cues and safety notes

Return ONLY valid JSON, no markdown.`;

  const userPrompt = `Generate the complete ${weeks}-week workout plan now.`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 second timeout

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.5,
        max_tokens: 6000, // Increased for complex workout plans
        response_format: { type: 'json_object' }, // Force JSON response
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[aiRouter] OpenAI API error:', response.status, errorText);
      return sendServerError(res, `OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      return sendServerError(res, 'No content in OpenAI response');
    }

    // Parse JSON, handle potential markdown code blocks
    let cleanContent = content.trim();
    if (cleanContent.startsWith('```json')) {
      cleanContent = cleanContent.slice(7);
    } else if (cleanContent.startsWith('```')) {
      cleanContent = cleanContent.slice(3);
    }
    if (cleanContent.endsWith('```')) {
      cleanContent = cleanContent.slice(0, -3);
    }

    let workoutPlan;
    try {
      workoutPlan = JSON.parse(cleanContent.trim());
    } catch (parseErr: any) {
      console.error('[aiRouter] Failed to parse workout plan JSON:', parseErr.message);
      console.error('[aiRouter] Raw content:', content.substring(0, 500));
      return sendServerError(res, 'AI returned invalid JSON. Please try again.');
    }

    // Validate structure
    if (!workoutPlan.weeks || !Array.isArray(workoutPlan.weeks) || workoutPlan.weeks.length !== weeks) {
      console.error('[aiRouter] Invalid workout plan structure');
      return sendServerError(res, 'Invalid workout plan structure');
    }

    return res.status(200).json({
      ok: true,
      plan: {
        ...workoutPlan,
        generatedAt: new Date().toISOString(),
        preferences: prefs,
      },
    });

  } catch (err: any) {
    if (err.name === 'AbortError') {
      console.warn('[aiRouter] OpenAI request timed out after 60s');
      return sendServerError(res, 'Request timed out - AI generation took too long. Try again.');
    }
    console.error('[aiRouter] Workout plan generation failed:', err.message);
    return sendServerError(res, err.message || 'Failed to generate workout plan');
  }
});

// ============================================================================
// AI COACH CHAT
// ============================================================================

interface CoachContext {
  mode: 'meal' | 'training' | 'general';
  userGoals?: {
    calorieTarget?: number;
    proteinTarget?: number;
    fitnessGoal?: string;
    activityLevel?: string;
  };
  recentMeals?: Array<{
    name: string;
    calories: number;
    protein: number;
  }>;
  recentWorkouts?: Array<{
    type: string;
    duration: number;
    date: string;
  }>;
  conversationHistory?: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
}

/**
 * POST /api/v1/ai/coach-message
 * AI coach chat with context-aware responses (meal, training, or general coaching)
 */
aiExtraRouter.post('/coach-message', aiRateLimit, async (req: Request, res: Response) => {
  const { message, context, shopifyCustomerId } = req.body;

  if (!message || typeof message !== 'string') {
    return sendError(res, 'Missing or invalid message', 400);
  }

  if (!context || !context.mode) {
    return sendError(res, 'Missing context with mode', 400);
  }

  if (!OPENAI_API_KEY) {
    return sendError(res, 'OpenAI API key not configured', 500);
  }

  const ctx = context as CoachContext;

  // Build system prompt based on coach mode
  let systemPrompt = '';

  if (ctx.mode === 'meal') {
    systemPrompt = `You are a nutrition coach helping users with meal planning and nutrition questions. Be encouraging, practical, and evidence-based.

User Goals:
${ctx.userGoals?.calorieTarget ? `- Daily calories: ${ctx.userGoals.calorieTarget}` : ''}
${ctx.userGoals?.proteinTarget ? `- Daily protein: ${ctx.userGoals.proteinTarget}g` : ''}
${ctx.userGoals?.activityLevel ? `- Activity level: ${ctx.userGoals.activityLevel}` : ''}

${ctx.recentMeals?.length ? `Recent meals:\n${ctx.recentMeals.map(m => `- ${m.name}: ${m.calories} cal, ${m.protein}g protein`).join('\n')}` : ''}

Keep responses concise (2-3 sentences). Be supportive and actionable.`;
  } else if (ctx.mode === 'training') {
    systemPrompt = `You are a fitness coach helping users with workout planning and training questions. Be motivating, safe, and science-backed.

User Goals:
${ctx.userGoals?.fitnessGoal ? `- Fitness goal: ${ctx.userGoals.fitnessGoal}` : ''}
${ctx.userGoals?.activityLevel ? `- Activity level: ${ctx.userGoals.activityLevel}` : ''}

${ctx.recentWorkouts?.length ? `Recent workouts:\n${ctx.recentWorkouts.map(w => `- ${w.type}: ${w.duration} min on ${w.date}`).join('\n')}` : ''}

Keep responses concise (2-3 sentences). Focus on form, safety, and progression.`;
  } else {
    systemPrompt = `You are a holistic health coach helping users achieve their health and fitness goals. Be encouraging, practical, and evidence-based.

User Goals:
${ctx.userGoals?.calorieTarget ? `- Daily calories: ${ctx.userGoals.calorieTarget}` : ''}
${ctx.userGoals?.fitnessGoal ? `- Fitness goal: ${ctx.userGoals.fitnessGoal}` : ''}
${ctx.userGoals?.activityLevel ? `- Activity level: ${ctx.userGoals.activityLevel}` : ''}

Keep responses concise (2-3 sentences). Be supportive and actionable.`;
  }

  try {
    // Build conversation history
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
    ];

    // Add conversation history (keep last 10 messages max)
    if (ctx.conversationHistory?.length) {
      const recentHistory = ctx.conversationHistory.slice(-10);
      messages.push(...recentHistory);
    }

    // Add current user message
    messages.push({ role: 'user', content: message });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout for chat

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages,
        temperature: 0.7,
        max_tokens: 500,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[aiRouter] OpenAI chat error:', response.status, errorText);
      return sendServerError(res, `OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const assistantMessage = data.choices?.[0]?.message?.content;

    if (!assistantMessage) {
      return sendServerError(res, 'No response from AI');
    }

    return res.status(200).json({
      ok: true,
      response: {
        message: assistantMessage,
        timestamp: new Date().toISOString(),
        mode: ctx.mode,
      },
    });

  } catch (err: any) {
    if (err.name === 'AbortError') {
      console.warn('[aiRouter] Chat request timed out after 10s');
      return sendServerError(res, 'Request timed out. Try again.');
    }
    console.error('[aiRouter] Coach chat failed:', err.message);
    return sendServerError(res, err.message || 'Failed to get coach response');
  }
});
