// Call OpenAI to build a WeekPlan that includes days[] + recipes[]
async function callOpenAiMealPlan(
  constraints: UserConstraints,
  pantry?: string[]
): Promise<WeekPlan> {
  if (!OPENAI_API_KEY) {
    console.warn("OPENAI_API_KEY is not set – cannot call OpenAI.");
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const payload = {
    model: OPENAI_MODEL,
    temperature: 0.6,
    // 🔴 NEW: strict JSON schema so the model must return valid JSON
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "week_plan",
        strict: true,
        schema: {
          type: "object",
          properties: {
            mode: { type: "string" },
            generatedAt: { type: "string" },
            constraints: { type: "object" },
            days: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  day: { anyOf: [{ type: "integer" }, { type: "string" }] },
                  index: { anyOf: [{ type: "integer" }, { type: "string" }] },
                  isoDate: { type: "string" },
                  label: { type: "string" },
                  note: { type: "string" },
                  meals: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        type: { type: "string" }, // "breakfast" | "lunch" | "dinner"
                        recipeId: { type: "string" },
                        title: { type: "string" },
                        calories: { type: "number" },
                        protein: { type: "number" },
                        carbs: { type: "number" },
                        fats: { type: "number" },
                        portionLabel: { type: "string" },
                        portionOz: { type: "number" },
                        servings: { type: "number" },
                        notes: { type: "string" },
                      },
                      required: ["type", "recipeId", "title"],
                    },
                  },
                },
                required: ["meals"],
              },
            },
            recipes: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  name: { type: "string" },
                  mealType: { type: "string" },
                  defaultServings: { type: "number" },
                  tags: {
                    type: "array",
                    items: { type: "string" },
                  },
                  ingredients: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        id: { type: "string" },
                        name: { type: "string" },
                        quantity: { anyOf: [{ type: "number" }, { type: "string" }] },
                        unit: { type: "string" },
                        instacart_query: { type: "string" },
                        category: { type: "string" },
                        pantry: { type: "boolean" },
                        optional: { type: "boolean" },
                        displayText: { type: "string" },
                        productIds: {
                          type: "array",
                          items: { anyOf: [{ type: "number" }, { type: "string" }] },
                        },
                        upcs: {
                          type: "array",
                          items: { type: "string" },
                        },
                        measurements: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              quantity: { type: "number" },
                              unit: { type: "string" },
                            },
                          },
                        },
                        filters: {
                          type: "object",
                          additionalProperties: true,
                        },
                      },
                      required: ["name"],
                    },
                  },
                },
                required: ["id", "name", "ingredients"],
              },
            },
          },
          required: ["days", "recipes"],
        },
      },
    } as const,
    messages: [
      {
        role: "system",
        content:
          "You are a nutrition coach creating detailed, practical 7-day meal plans " +
          "for a health + grocery shopping app. " +
          "Return ONLY JSON that matches the provided JSON schema.",
      },
      {
        role: "user",
        content: JSON.stringify({
          instructions:
            "Create a 7-day meal plan that fits these macros, budget, allergies, and cooking skill. " +
            "Breakfast, lunch, and dinner each day. Use realistic, simple recipes that are easy to cook.",
          constraints,
          pantry: pantry || [],
        }),
      },
    ],
  };

  console.log("Calling OpenAI /chat/completions with model:", OPENAI_MODEL);

  const resp = await fetchWithTimeout(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify(payload),
    },
    OPENAI_TIMEOUT_MS
  );

  if (!resp.ok) {
    const txt = await resp.text();
    console.error("OpenAI /chat/completions error:", resp.status, txt);
    throw new Error(`OpenAI error: HTTP ${resp.status}`);
  }

  const raw = (await resp.json()) as any;
  const msg = raw?.choices?.[0]?.message;

  // Log trimmed raw so we can debug shapes without crashing logs
  try {
    console.log("OPENAI_RAW_MESSAGE", JSON.stringify(raw).slice(0, 2000));
  } catch {
    console.log("OPENAI_RAW_MESSAGE (non-serializable)", raw);
  }

  let planAny: any;

  if (msg?.parsed) {
    // Newer API: JSON already parsed into `parsed`
    console.log("Using OpenAI message.parsed as WeekPlan");
    planAny = msg.parsed;
  } else if (typeof msg?.content === "string") {
    const content = msg.content.trim();
    console.log("RAW_OPENAI_CONTENT_START");
    console.log(content.slice(0, 2000)); // avoid log spam
    console.log("RAW_OPENAI_CONTENT_END");

    planAny = JSON.parse(content);
  } else if (msg?.content && typeof msg.content === "object") {
    console.log(
      "OpenAI message.content is already an object; using it directly."
    );
    planAny = msg.content;
  } else {
    console.error("OpenAI response missing usable JSON content:", raw);
    throw new Error("OpenAI response missing usable JSON content");
  }

  const plan = planAny as WeekPlan;
  const anyPlan = plan as any;

  if (!anyPlan || !Array.isArray(anyPlan.days)) {
    console.error("OpenAI JSON did not include days[] as expected:", plan);
    throw new Error("Invalid WeekPlan shape from OpenAI (missing days[])");
  }

  if (!Array.isArray(anyPlan.recipes)) {
    console.warn(
      "OpenAI JSON missing recipes[]; adding empty recipes array to keep frontend safe."
    );
    anyPlan.recipes = [];
  }

  anyPlan.mode = "ai";
  anyPlan.generatedAt = anyPlan.generatedAt || new Date().toISOString();

  return plan;
}
