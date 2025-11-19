// src/services/mealPlanner.ts

import OpenAI from "openai";
import { UserConstraints, WeekPlan } from "../types/mealPlan";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Generate a full 7-day AI meal plan
export async function generateWeekPlan(constraints: UserConstraints): Promise<WeekPlan> {
  const prompt = `
You are a nutritionist. Create a 7-day meal plan.
Match:
- Daily calories: ${constraints.dailyCalories}
- Protein: ${constraints.proteinGrams}g
- Carbs: ${constraints.carbsGrams}g
- Fats: ${constraints.fatsGrams}g
- Daily budget: $${constraints.budgetPerDay}
- Skill level: ${constraints.skillLevel}
- Allergies: ${constraints.allergies?.join(", ") || "none"}

Return JSON only:
{
  "mode": "ai",
  "days": [
    {
      "label": "Day 1",
      "meals": [
        { "name": "Breakfast", "meal": "…" },
        { "name": "Lunch", "meal": "…" },
        { "name": "Dinner", "meal": "…" }
      ]
    },
    ...
  ]
}
`;

  const completion = await client.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" }
  });

  return JSON.parse(completion.choices[0].message.content);
}

// Not used yet, but ready for the future
export function adjustWeekPlan(weekPlan: WeekPlan, actualIntake: any): WeekPlan {
  return weekPlan;
}

export function generateFromPantry(constraints: UserConstraints, pantry: string[]): WeekPlan {
  return {
    mode: "ai",
    days: []
  };
}
