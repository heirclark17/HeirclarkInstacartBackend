// src/services/aiPromptTemplates.ts
// Centralized AI Prompt Templates for Heirclark Platform
// Maintains consistent, high-quality prompts across all AI features

// ==========================================================================
// Meal Planning Prompts
// ==========================================================================

export const MEAL_PLAN_PROMPTS = {
  // System prompt for meal plan generation
  SYSTEM: `You are an expert nutritionist and meal planner for the Heirclark fitness platform.

Your role is to create personalized, practical meal plans that:
1. Meet exact macro and calorie targets (within 5% tolerance)
2. Use whole, nutritious foods with high protein sources
3. Balance variety and practicality (some meal prep, some quick meals)
4. Consider budget constraints when specified
5. Accommodate dietary restrictions and allergies strictly

Guidelines:
- Prioritize lean proteins: chicken breast, turkey, fish, Greek yogurt, eggs, tofu
- Include fiber-rich vegetables at every meal
- Use complex carbs: oats, brown rice, quinoa, sweet potato
- Include healthy fats: avocado, olive oil, nuts in moderation
- Keep sodium reasonable (<2500mg/day)
- Make weekday breakfasts quick (<15 min prep)
- Allow more elaborate cooking on weekends

Always return valid JSON matching the requested structure.`,

  // Generate a complete week plan
  GENERATE_WEEK: (params: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    restrictions?: string[];
    allergies?: string[];
    cuisines?: string[];
    skill?: string;
    maxPrepTime?: number;
    mealsPerDay?: number;
    pantryItems?: string;
    budget?: string;
  }) => `
Generate a 7-day meal plan with the following requirements:

NUTRITION TARGETS (per day):
- Calories: ${params.calories}
- Protein: ${params.protein}g
- Carbs: ${params.carbs}g
- Fat: ${params.fat}g

DIETARY REQUIREMENTS:
- Restrictions: ${params.restrictions?.join(', ') || 'None'}
- Allergies: ${params.allergies?.join(', ') || 'None'}
- Cuisine preferences: ${params.cuisines?.join(', ') || 'Any'}
- Cooking skill: ${params.skill || 'intermediate'}
- Max prep time: ${params.maxPrepTime || 45} minutes
- Meals per day: ${params.mealsPerDay || 3}

${params.pantryItems ? `PANTRY ITEMS TO USE: ${params.pantryItems}` : ''}
${params.budget ? `BUDGET: ${params.budget}` : ''}

Return JSON with: days (array of 7 days with meals), grocery_list, ai_notes.`,

  // Swap a single meal
  SWAP_MEAL: (params: {
    currentMeal: string;
    mealType: string;
    reason?: string;
    preferences?: string;
    constraints: string;
  }) => `
The user wants to swap this meal: "${params.currentMeal}" (${params.mealType})
Reason: ${params.reason || 'User preference'}
${params.preferences ? `Preferences: ${params.preferences}` : ''}

Constraints: ${params.constraints}

Suggest 3 alternative meals with similar macros. Return JSON: { alternatives: [...] }`,

  // Explain plan to user
  EXPLAIN_PLAN: (params: {
    weeklyCalories: number;
    weeklyProtein: number;
    targetCalories: number;
    targetProtein: number;
    groceryCount: number;
    weeklyCost?: number;
    sampleMeals: string;
  }) => `
Explain this meal plan to the user in a friendly, encouraging way.

User's Goals:
- Daily calories: ${params.targetCalories}
- Daily protein: ${params.targetProtein}g

Plan Summary:
- Average daily calories: ${Math.round(params.weeklyCalories / 7)}
- Average daily protein: ${Math.round(params.weeklyProtein / 7)}g
- Total grocery items: ${params.groceryCount}
${params.weeklyCost ? `- Weekly cost: $${(params.weeklyCost / 100).toFixed(2)}` : ''}

Sample meals:
${params.sampleMeals}

Write 2-3 paragraphs that:
1. Highlight how the plan meets their goals
2. Mention key protein sources and variety
3. Give one practical meal prep tip`,
};

// ==========================================================================
// Nutrition Analysis Prompts
// ==========================================================================

export const NUTRITION_PROMPTS = {
  // System prompt for food photo analysis
  PHOTO_ANALYSIS_SYSTEM: `You are an expert nutritionist analyzing food photos for the Heirclark app.

Your task is to:
1. Identify all foods visible in the image
2. Estimate portion sizes using visual cues (plate size, utensils, hands)
3. Calculate approximate calories and macros for each item
4. Consider cooking methods (fried adds ~50-100 cal, grilled is leaner)
5. Account for hidden calories (oils, sauces, butter)

Be accurate but not overly conservative. Users trust your estimates for tracking.`,

  // Analyze a food photo
  ANALYZE_PHOTO: (params: {
    mealType?: string;
    userNotes?: string;
    recentMeals?: string;
  }) => `
Analyze this food photo and provide nutrition estimates.

${params.mealType ? `Meal type: ${params.mealType}` : ''}
${params.userNotes ? `User notes: ${params.userNotes}` : ''}
${params.recentMeals ? `Recent meals context: ${params.recentMeals}` : ''}

Return JSON:
{
  "foods": [
    {
      "name": "food name",
      "portion": "estimated portion (e.g., 6 oz, 1 cup)",
      "calories": 000,
      "protein_g": 00,
      "carbs_g": 00,
      "fat_g": 00,
      "confidence": 0.85
    }
  ],
  "total": { "calories": 000, "protein_g": 00, "carbs_g": 00, "fat_g": 00 },
  "notes": "Brief observation about the meal"
}`,

  // Verify nutrition data quality
  VERIFY_FOOD_DATA: (params: {
    foodName: string;
    brand?: string;
    nutrients: string;
    source: string;
  }) => `
Verify this nutrition data for accuracy:

Food: ${params.foodName}
${params.brand ? `Brand: ${params.brand}` : ''}
Source: ${params.source}
Nutrients: ${params.nutrients}

Check for:
1. Reasonable calorie-to-macro ratio (cal ≈ protein*4 + carbs*4 + fat*9)
2. Typical ranges for this food type
3. Any suspicious outliers

Return JSON: { "valid": true/false, "issues": [], "suggested_corrections": {} }`,
};

// ==========================================================================
// Coaching & Behavior Change Prompts
// ==========================================================================

export const COACHING_PROMPTS = {
  // System prompt for AI coach
  COACH_SYSTEM: `You are a supportive fitness and nutrition coach for the Heirclark app.

Your style:
- Warm, encouraging, but not patronizing
- Evidence-based advice
- Focus on sustainable habits over quick fixes
- Celebrate small wins
- Acknowledge struggles with empathy
- Keep responses concise (2-3 sentences unless more detail needed)

You help users with:
- Understanding their nutrition and fitness goals
- Building consistent habits
- Overcoming plateaus and setbacks
- Interpreting their progress data`,

  // Daily check-in
  DAILY_CHECKIN: (params: {
    userName: string;
    dayOfWeek: string;
    recentProgress?: string;
    currentStreak?: number;
    todayGoals?: string;
  }) => `
Generate a brief morning check-in message for ${params.userName}.

Context:
- Day: ${params.dayOfWeek}
${params.currentStreak ? `- Current streak: ${params.currentStreak} days` : ''}
${params.recentProgress ? `- Recent progress: ${params.recentProgress}` : ''}
${params.todayGoals ? `- Today's goals: ${params.todayGoals}` : ''}

Write 2-3 sentences that:
1. Greet them appropriately for the day
2. Reference something specific to their progress
3. Give one actionable focus for today`,

  // Progress reflection
  PROGRESS_REFLECTION: (params: {
    userName: string;
    period: string;
    caloriesAvg: number;
    proteinAvg: number;
    targetCalories: number;
    targetProtein: number;
    weightChange?: number;
    consistencyRate?: number;
  }) => `
Generate a progress reflection for ${params.userName} for the past ${params.period}.

Data:
- Average daily calories: ${params.caloriesAvg} (target: ${params.targetCalories})
- Average daily protein: ${params.proteinAvg}g (target: ${params.targetProtein}g)
${params.weightChange !== undefined ? `- Weight change: ${params.weightChange > 0 ? '+' : ''}${params.weightChange} lbs` : ''}
${params.consistencyRate ? `- Logging consistency: ${params.consistencyRate}%` : ''}

Write 3-4 sentences that:
1. Summarize their adherence honestly
2. Highlight one positive trend
3. Identify one area for improvement
4. End with encouragement`,

  // Micro-lesson on a topic
  MICRO_LESSON: (params: {
    topic: string;
    userLevel: string;
    context?: string;
  }) => `
Create a brief micro-lesson on: ${params.topic}

User level: ${params.userLevel}
${params.context ? `Context: ${params.context}` : ''}

Structure (keep under 150 words):
1. One key insight or fact
2. Why it matters for their goals
3. One simple action they can take today

Use conversational language, not academic.`,
};

// ==========================================================================
// Body Scan & Recomposition Prompts
// ==========================================================================

export const BODY_SCAN_PROMPTS = {
  // Analyze progress photos
  PROGRESS_COMPARISON: (params: {
    daysBetween: number;
    photoTypes: string;
    weightChange?: number;
    bodyFatChange?: number;
  }) => `
Analyze these progress photos taken ${params.daysBetween} days apart.
Photo types: ${params.photoTypes}
${params.weightChange !== undefined ? `Weight change: ${params.weightChange > 0 ? '+' : ''}${params.weightChange} lbs` : ''}
${params.bodyFatChange !== undefined ? `Body fat change: ${params.bodyFatChange > 0 ? '+' : ''}${params.bodyFatChange}%` : ''}

Provide an encouraging, honest assessment:
1. Visible changes (be specific: arms, shoulders, waist, etc.)
2. Areas showing progress
3. Realistic expectations going forward

Keep it positive but truthful. Don't invent changes that aren't visible.`,

  // Generate body recomposition report
  RECOMP_REPORT: (params: {
    startDate: string;
    endDate: string;
    startWeight: number;
    endWeight: number;
    startBodyFat?: number;
    endBodyFat?: number;
    avgCalories: number;
    avgProtein: number;
    workoutsPerWeek: number;
  }) => `
Generate a body recomposition report:

Period: ${params.startDate} to ${params.endDate}

Measurements:
- Weight: ${params.startWeight} → ${params.endWeight} lbs
${params.startBodyFat && params.endBodyFat ? `- Body fat: ${params.startBodyFat}% → ${params.endBodyFat}%` : ''}

Nutrition (averages):
- Daily calories: ${params.avgCalories}
- Daily protein: ${params.avgProtein}g
- Workouts per week: ${params.workoutsPerWeek}

Write a report with:
1. Summary of progress (2-3 sentences)
2. What's working well
3. Optimization opportunities
4. Recommended focus for next 4 weeks`,
};

// ==========================================================================
// RAG & Knowledge Base Prompts
// ==========================================================================

export const RAG_PROMPTS = {
  // Answer nutrition question with RAG context
  ANSWER_WITH_CONTEXT: (params: {
    question: string;
    context: string;
    userProfile?: string;
  }) => `
Answer this nutrition/fitness question using the provided context.

Question: ${params.question}

Context from knowledge base:
${params.context}

${params.userProfile ? `User profile: ${params.userProfile}` : ''}

Guidelines:
- Use the context to inform your answer
- If context is insufficient, say so honestly
- Keep answer concise (2-4 sentences)
- Cite specific foods/nutrients when relevant`,

  // Generate embedding query
  REWRITE_FOR_EMBEDDING: (question: string) => `
Rewrite this user question into a clear search query for a nutrition/fitness knowledge base.

Original: "${question}"

Return just the optimized search query, no explanation.`,
};

// ==========================================================================
// Utility Functions
// ==========================================================================

export function formatMacrosForPrompt(nutrients: {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}): string {
  return `${nutrients.calories} cal, ${nutrients.protein_g}g protein, ${nutrients.carbs_g}g carbs, ${nutrients.fat_g}g fat`;
}

export function formatMealListForPrompt(meals: Array<{ meal_type: string; name: string }>): string {
  return meals.map(m => `- ${m.meal_type}: ${m.name}`).join('\n');
}

export default {
  MEAL_PLAN_PROMPTS,
  NUTRITION_PROMPTS,
  COACHING_PROMPTS,
  BODY_SCAN_PROMPTS,
  RAG_PROMPTS,
  formatMacrosForPrompt,
  formatMealListForPrompt,
};
