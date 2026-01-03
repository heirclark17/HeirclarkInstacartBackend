import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export interface AiMealEstimate {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  label: "Breakfast" | "Lunch" | "Dinner" | "Snack" | null;
  mealName: string;
  explanation: string;
}

/**
 * Use OpenAI to turn a free-text meal description into
 * calories + macros + meal label.
 */
export async function estimateMealFromText(
  text: string,
  localTimeIso?: string
): Promise<AiMealEstimate> {
  if (!text || !text.trim()) {
    throw new Error("No meal description provided.");
  }

  const now = localTimeIso ? new Date(localTimeIso) : new Date();
  const hour = now.getHours();

  const systemPrompt = `
You are a nutrition assistant for a calorie-tracking app.
Estimate nutrients for what the user ate.

Return a *strict JSON object* with this exact shape:

{
  "calories": number,
  "protein": number,
  "carbs": number,
  "fat": number,
  "label": "Breakfast" | "Lunch" | "Dinner" | "Snack" | null,
  "mealName": string,
  "explanation": string
}

Rules:
- Use realistic estimates based on common portion sizes if not specified.
- "calories" is total kcal for the described meal.
- "protein", "carbs", "fat" are grams.
- "mealName" should be a short, human-friendly label, like "Eggs & Toast with Orange".
- "explanation" is 1–2 short sentences explaining your reasoning.
- For "label":
  - Use the foods and time-of-day to pick Breakfast, Lunch, Dinner, or Snack.
  - If uncertain, choose the best guess; use null only if truly unknown.
`;

  const userPrompt = `
Meal description: "${text}"
Local time ISO: "${localTimeIso || ""}" (hour=${hour})
`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt.trim() },
      { role: "user", content: userPrompt.trim() },
    ],
    temperature: 0.2,
  });

  const rawContent = completion.choices[0]?.message?.content || "{}";

  let parsed: any;
  try {
    parsed = JSON.parse(rawContent);
  } catch (err) {
    console.error("Failed to parse AI meal JSON:", rawContent, err);
    throw new Error("AI returned an invalid JSON response.");
  }

  // Defensive parsing + sane fallbacks
  const result: AiMealEstimate = {
    calories: Number(parsed.calories) || 0,
    protein: Number(parsed.protein) || 0,
    carbs: Number(parsed.carbs) || 0,
    fat: Number(parsed.fat) || 0,
    label:
      parsed.label === "Breakfast" ||
      parsed.label === "Lunch" ||
      parsed.label === "Dinner" ||
      parsed.label === "Snack"
        ? parsed.label
        : null,
    mealName:
      typeof parsed.mealName === "string" && parsed.mealName.trim()
        ? parsed.mealName.trim()
        : "Meal",
    explanation:
      typeof parsed.explanation === "string" && parsed.explanation.trim()
        ? parsed.explanation.trim()
        : "Automatic estimate based on typical nutrition values.",
  };

  return result;
}
