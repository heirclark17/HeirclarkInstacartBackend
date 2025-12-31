import Anthropic from '@anthropic-ai/sdk';

/**
 * Script Generator Service
 * Uses Claude to generate personalized video scripts for HeyGen avatars
 */

interface WellnessData {
  dailyCalories?: number;
  dailyProtein?: number;
  dailyCarbs?: number;
  dailyFats?: number;
  goalDirection?: 'lose' | 'gain' | 'maintain';
  currentWeightLb?: number;
  targetWeightLb?: number;
  bmr?: number;
  tdee?: number;
}

interface MealData {
  type: string;
  title?: string;
  name?: string;
  calories?: number;
  protein?: number;
  carbs?: number;
  fats?: number;
}

interface DayPlan {
  day: number;
  label?: string;
  meals?: MealData[];
}

interface WeekPlan {
  days?: DayPlan[];
  recipes?: Array<{
    id: string;
    name?: string;
    title?: string;
    ingredients?: any[];
  }>;
}

interface UserPreferences {
  dietType?: string;
  cookingSkill?: string;
  budgetPerDay?: number;
  allergies?: string[];
}

function getAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY environment variable is not set');
  }
  return new Anthropic({ apiKey });
}

/**
 * Generate a personalized video script based on the user's nutrition plan
 */
export async function generateVideoScript(
  weekPlan: WeekPlan,
  wellness: WellnessData,
  preferences?: UserPreferences,
  userName?: string
): Promise<string> {
  const client = getAnthropicClient();

  // Extract key information for the script
  const dailyCalories = wellness.dailyCalories || 2000;
  const protein = wellness.dailyProtein || 150;
  const carbs = wellness.dailyCarbs || 200;
  const fats = wellness.dailyFats || 65;
  const goal = wellness.goalDirection || 'maintain';

  // Get sample meals from the plan
  const sampleMeals: string[] = [];
  if (weekPlan.days && weekPlan.days.length > 0) {
    for (const day of weekPlan.days.slice(0, 3)) {
      if (day.meals) {
        for (const meal of day.meals) {
          const mealName = meal.title || meal.name;
          if (mealName && sampleMeals.length < 5) {
            sampleMeals.push(mealName);
          }
        }
      }
    }
  }

  // Get unique ingredients for prep tips
  const ingredients = new Set<string>();
  if (weekPlan.recipes) {
    for (const recipe of weekPlan.recipes.slice(0, 5)) {
      if (recipe.ingredients && Array.isArray(recipe.ingredients)) {
        for (const ing of recipe.ingredients.slice(0, 3)) {
          const name = typeof ing === 'string' ? ing : ing?.name;
          if (name) ingredients.add(name);
        }
      }
    }
  }

  const goalText = {
    lose: 'weight loss',
    gain: 'muscle building',
    maintain: 'maintaining your healthy weight',
  }[goal] || 'your health goals';

  const dietText = preferences?.dietType
    ? ` following a ${preferences.dietType} approach`
    : '';

  const prompt = `You are a friendly, encouraging nutrition coach creating a 60-second video script for a user who just completed their personalized 7-day meal plan in the HeirClark nutrition app.

USER'S PLAN DETAILS:
- Name: ${userName || 'there'}
- Daily calories: ${dailyCalories} kcal
- Macros: ${protein}g protein, ${carbs}g carbs, ${fats}g fat
- Goal: ${goalText}${dietText}
- Sample meals from their plan: ${sampleMeals.join(', ') || 'various healthy meals'}
- Key ingredients to prep: ${Array.from(ingredients).slice(0, 5).join(', ') || 'proteins and vegetables'}

SCRIPT REQUIREMENTS:
1. Keep it UNDER 60 seconds when spoken (about 150-180 words max)
2. Be warm, personal, and motivating - use their name
3. Include these sections (brief, natural flow):
   - Congratulations on completing their 7-day plan
   - Quick summary of their daily targets
   - Mention 1-2 exciting meals from their plan
   - One specific meal prep tip based on their ingredients
   - Motivational close with encouragement

4. Tone: Confident but friendly coach, not robotic
5. NO stage directions, just the spoken text
6. Use natural pauses (periods, commas) for pacing
7. Keep language simple and conversational

Write ONLY the script text that the avatar will speak. No headers, no formatting, just the natural speech.`;

  try {
    const response = await client.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 500,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    const textContent = response.content.find((block: { type: string }) => block.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No text content in Claude response');
    }

    let script = textContent.text.trim();

    // Clean up any markdown or formatting that might have slipped through
    script = script
      .replace(/^#+\s*/gm, '')
      .replace(/\*\*/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    console.log(`[scriptGenerator] Generated script (${script.length} chars)`);
    return script;
  } catch (error: any) {
    console.error('[scriptGenerator] Failed to generate script:', error.message);

    // Return a fallback script if Claude fails
    return generateFallbackScript(userName, dailyCalories, protein, carbs, fats, goal);
  }
}

/**
 * Fallback script if Claude API fails
 */
function generateFallbackScript(
  userName: string | undefined,
  calories: number,
  protein: number,
  carbs: number,
  fats: number,
  goal: string
): string {
  const name = userName || 'there';
  const goalText = goal === 'lose' ? 'weight loss' : goal === 'gain' ? 'building muscle' : 'maintaining your health';

  return `Hey ${name}! Congratulations on completing your personalized 7-day nutrition plan. This is a huge step toward ${goalText}.

Your plan is built around ${calories} calories per day, with ${protein} grams of protein, ${carbs} grams of carbs, and ${fats} grams of healthy fats. These macros are specifically calculated for your goals.

Here's a pro tip to make your week easier: spend about 30 minutes on Sunday prepping your proteins. Cook a batch of chicken, portion it out, and you'll save time every single day.

Remember, consistency beats perfection. You don't have to be perfect, you just have to keep showing up. I believe in you. Let's crush this week together!`;
}

/**
 * Create a hash of the plan for change detection
 */
export function hashPlan(weekPlan: WeekPlan, wellness: WellnessData): string {
  const crypto = require('crypto');
  const data = JSON.stringify({
    days: weekPlan.days?.length || 0,
    calories: wellness.dailyCalories,
    protein: wellness.dailyProtein,
    recipeCount: weekPlan.recipes?.length || 0,
  });
  return crypto.createHash('sha256').update(data).digest('hex').substring(0, 16);
}
