import express, { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import cors from "cors"; // ✅ CORS import

// Types / services
import { UserConstraints, WeekPlan } from "./types/mealPlan";
import {
  generateWeekPlan,
  adjustWeekPlan,
  generateFromPantry,
} from "./services/mealPlanner";

const app = express();
const PORT = process.env.PORT || 3000;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS || 25000); // 25s

// ✅ Allow your Shopify storefront (and other origins) to call this backend
app.use(
  cors({
    origin: true, // you can tighten this later to your exact shop domain
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  })
);

// ✅ Preflight handling
app.options("*", cors());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ======================================================================
//                         OPENAI HELPERS
// ======================================================================

// Enforce a timeout on OpenAI calls
function fetchWithTimeout(
  url: string,
  options: any,
  timeoutMs: number
): Promise<globalThis.Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  return fetch(url, { ...options, signal: controller.signal }).finally(() => {
    clearTimeout(id);
  });
}

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
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "week_plan",
        // NOTE: we are NOT using strict: true here, to avoid schema meta errors
        schema: {
          type: "object",
          properties: {
            mode: { type: "string" },
            generatedAt: { type: "string" },

            // Let OpenAI echo constraints, we don't over-specify
            constraints: {
              type: "object",
            },

            days: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  day: {
                    anyOf: [{ type: "integer" }, { type: "string" }],
                  },
                  index: {
                    anyOf: [{ type: "integer" }, { type: "string" }],
                  },
                  isoDate: { type: "string" },
                  label: { type: "string" },
                  note: { type: "string" },
                  meals: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        type: { type: "string" },
                        name: { type: "string" },
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
                    },
                  },
                },
              },
            },

            recipes: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  name: { type: "string" },
                  title: { type: "string" },
                  mealType: { type: "string" },
                  defaultServings: { type: "number" },
                  tags: {
                    type: "array",
                    items: { type: "string" },
                  },
                  ingredients: {
                    type: "array",
                    items: {
                      anyOf: [
                        { type: "string" },
                        {
                          type: "object",
                          properties: {
                            id: { type: "string" },
                            name: { type: "string" },
                            quantity: {
                              anyOf: [
                                { type: "number" },
                                { type: "string" },
                              ],
                            },
                            unit: { type: "string" },
                            instacart_query: { type: "string" },
                            category: { type: "string" },
                            pantry: { type: "boolean" },
                            optional: { type: "boolean" },
                            displayText: { type: "string" },
                            productIds: {
                              type: "array",
                              items: {
                                anyOf: [
                                  { type: "number" },
                                  { type: "string" },
                                ],
                              },
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
                            },
                          },
                        },
                      ],
                    },
                  },
                },
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

  // Debug log
  try {
    console.log("OPENAI_RAW_MESSAGE", JSON.stringify(raw).slice(0, 2000));
  } catch {
    console.log("OPENAI_RAW_MESSAGE (non-serializable)", raw);
  }

  let aiJson: any;

  if (msg?.parsed) {
    console.log("Using OpenAI message.parsed as WeekPlan source");
    aiJson = msg.parsed;
  } else if (typeof msg?.content === "string") {
    const content = msg.content.trim();
    console.log("RAW_OPENAI_CONTENT_START");
    console.log(content.slice(0, 2000));
    console.log("RAW_OPENAI_CONTENT_END");
    aiJson = JSON.parse(content);
  } else if (msg?.content && typeof msg.content === "object") {
    console.log(
      "OpenAI message.content is already an object; using it directly."
    );
    aiJson = msg.content;
  } else {
    console.error("OpenAI response missing usable JSON content:", raw);
    throw new Error("OpenAI response missing usable JSON content");
  }

  // --------- ADAPT OpenAI JSON → canonical WeekPlan shape ---------
  const rawDays = Array.isArray(aiJson.days) ? aiJson.days : [];
  const rawRecipes = Array.isArray(aiJson.recipes) ? aiJson.recipes : [];

  // Build recipe map & normalize recipes into Recipe[]
  const recipeMap = new Map<string, { id: string; title: string }>();

  const recipes = rawRecipes.map((r: any) => {
    const id = String(r.id || "").trim();
    const name =
      (r.name && String(r.name).trim()) ||
      (r.title && String(r.title).trim()) ||
      (id ? `Recipe ${id}` : "Recipe");

    if (id) {
      recipeMap.set(id, { id, title: name });
    }

    const ingredients = Array.isArray(r.ingredients)
      ? r.ingredients.map((ing: any) => {
          if (typeof ing === "string") {
            return {
              name: ing,
              displayText: ing,
            };
          }

          const ingName =
            (ing.name && String(ing.name).trim()) ||
            (ing.displayText && String(ing.displayText).trim()) ||
            "Ingredient";

          return {
            name: ingName,
            quantity: ing.quantity,
            unit: ing.unit,
            instacart_query: ing.instacart_query,
            category: ing.category,
            pantry: ing.pantry,
            optional: ing.optional,
            displayText: ing.displayText || ingName,
            productIds: ing.productIds,
            upcs: ing.upcs,
            measurements: ing.measurements,
            filters: ing.filters,
          };
        })
      : [];

    return {
      id: id || name,
      name,
      mealType: r.mealType,
      defaultServings: r.defaultServings,
      tags: Array.isArray(r.tags)
        ? r.tags.map((t: any) => String(t))
        : undefined,
      ingredients,
    };
  });

  // Normalize days & meals
  const days = rawDays.map((d: any, idx: number) => {
    const dayNumber = d.day ?? idx + 1;
    const label =
      d.label ||
      (typeof dayNumber === "number" ? `Day ${dayNumber}` : `Day ${idx + 1}`);

    const meals = Array.isArray(d.meals)
      ? d.meals.map((m: any) => {
          const rawType = (m.type || m.name || "").toString().toLowerCase();
          let type: string = "other";
          if (rawType.includes("breakfast")) type = "breakfast";
          else if (rawType.includes("lunch")) type = "lunch";
          else if (rawType.includes("dinner")) type = "dinner";

          const rid = m.recipeId ? String(m.recipeId) : undefined;
          const recMeta = rid ? recipeMap.get(rid) : undefined;

          return {
            type,
            recipeId: rid,
            title: m.title || recMeta?.title || m.name || "Meal",
            calories: m.calories,
            protein: m.protein,
            carbs: m.carbs,
            fats: m.fats,
            portionLabel: m.portionLabel,
            portionOz: m.portionOz,
            servings: m.servings,
            notes: m.notes,
          };
        })
      : [];

    return {
      day: dayNumber,
      index: d.index ?? idx,
      isoDate: d.isoDate,
      label,
      note: d.note,
      meals,
    };
  });

  const weekPlan: WeekPlan = {
    mode: "ai",
    generatedAt: new Date().toISOString(),
    constraints,
    days: days as any,
    recipes: recipes as any,
  };

  console.log("AI_WEEKPLAN_OK");
  return weekPlan;
}

// Call OpenAI to build a *single-day* plan (3 meals) instead of full week
async function callOpenAiDayPlan(
  constraints: UserConstraints,
  dayPayload: {
    dayIndex: number;
    label: string;
    isoDate: string;
    meals: Array<{
      type: string;
      targets: {
        calories?: number;
        protein?: number;
        carbs?: number;
        fats?: number;
      };
    }>;
  }
): Promise<{ day: any; recipes: any[] }> {
  if (!OPENAI_API_KEY) {
    console.warn("OPENAI_API_KEY is not set – cannot call OpenAI.");
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const payload = {
    model: OPENAI_MODEL,
    temperature: 0.5,
    response_format: { type: "json_object" as const },
    messages: [
      {
        role: "system",
        content:
          "You are a nutrition coach creating a ONE-DAY meal plan (breakfast, lunch, dinner) " +
          "for a health + grocery shopping app. Always respond with strict JSON only.",
      },
      {
        role: "user",
        content: JSON.stringify({
          instructions:
            "Generate a simple, affordable 1-day meal plan with exactly 3 meals: breakfast, lunch, dinner. " +
            "Match the calorie + macro targets per meal as closely as practical. Use realistic, easy recipes.",
          constraints,
          day: dayPayload,
          requiredJsonShape: {
            day: {
              day: dayPayload.dayIndex,
              label: dayPayload.label,
              isoDate: dayPayload.isoDate,
              meals: [
                {
                  type: "breakfast | lunch | dinner",
                  title: "string",
                  recipeId: "string",
                  calories: "number",
                  protein: "number",
                  carbs: "number",
                  fats: "number",
                  portionLabel: "string",
                  servings: "number",
                  ingredients: [
                    {
                      name: "string",
                      quantity: "number",
                      unit: "string",
                      instacart_query: "string",
                    },
                  ],
                  instructions: ["string", "string"],
                },
              ],
            },
            recipes: [
              {
                id: "string (must match recipeId)",
                name: "string",
                ingredients: [
                  {
                    name: "string",
                    quantity: "number",
                    unit: "string",
                    instacart_query: "string",
                  },
                ],
                instructions: ["string", "string"],
                calories: "number",
                protein: "number",
                carbs: "number",
                fats: "number",
              },
            ],
          },
        }),
      },
    ],
  };

  console.log(
    "Calling OpenAI /chat/completions (single day) with model:",
    OPENAI_MODEL,
    "for day",
    dayPayload.dayIndex
  );

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
    console.error("OpenAI /chat/completions DAY error:", resp.status, txt);
    throw new Error(`OpenAI day-plan error: HTTP ${resp.status}`);
  }

  const raw = (await resp.json()) as any;
  const msg = raw?.choices?.[0]?.message;

  let parsed: any;
  if (typeof msg?.content === "string") {
    const content = msg.content.trim();
    console.log("RAW_DAY_OPENAI_CONTENT_START");
    console.log(content.slice(0, 1000));
    console.log("RAW_DAY_OPENAI_CONTENT_END");
    parsed = JSON.parse(content);
  } else if (msg?.parsed) {
    parsed = msg.parsed;
  } else if (msg?.content && typeof msg.content === "object") {
    parsed = msg.content;
  } else {
    throw new Error("OpenAI day-plan response missing JSON content");
  }

  const day = parsed.day || parsed.Day || parsed.dayPlan || {};
  const recipes = Array.isArray(parsed.recipes) ? parsed.recipes : [];

  return { day, recipes };
}

// ======================================================================
//                 WEIGHT VISION (IMAGE + MORPH TARGETS)
// ======================================================================

type WeightVisionRequest = {
  height_cm: number;
  weight_kg: number;
  waist_cm?: number;
  gender: string;
  body_fat?: number;
  pose?: string;
  style?: string;
};

type WeightVisionResult = {
  image_url: string;
  morph_targets: {
    chest: number;
    waist: number;
    hips: number;
    arms: number;
    thighs: number;
  };
  prompt_used: string;
  pose: string;
  style: string;
};

// ChatGPT 4.1-mini → JSON (prompt + morph targets) + DALL·E 3 → silhouette
async function callOpenAiWeightVision(
  params: WeightVisionRequest
): Promise<WeightVisionResult> {
  if (!OPENAI_API_KEY) {
    console.warn("OPENAI_API_KEY is not set – cannot call OpenAI.");
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const {
    height_cm,
    weight_kg,
    waist_cm,
    gender,
    body_fat,
    pose = "front",
    style = "simple silhouette, plain background",
  } = params;

  const chatPayload = {
    model: OPENAI_MODEL,
    response_format: { type: "json_object" as const },
    temperature: 0.4,
    messages: [
      {
        role: "system",
        content:
          "You generate JSON for a fitness body-vision app.\n\n" +
          "Input: height_cm, weight_kg, waist_cm, gender, body_fat, pose, style.\n" +
          "Output JSON fields:\n" +
          "  - image_prompt: string (for an AI silhouette image)\n" +
          "  - morph_targets: { chest, waist, hips, arms, thighs } (each 0.0-1.0)\n\n" +
          "Rules:\n" +
          " - ONLY return valid JSON, no markdown, no commentary.\n" +
          " - morph_targets must always include all 5 fields and be between 0 and 1.\n" +
          " - image_prompt should describe a neutral, front-facing, full-body silhouette unless pose says otherwise.\n",
      },
      {
        role: "user",
        content: JSON.stringify({
          height_cm,
          weight_kg,
          waist_cm,
          gender,
          body_fat,
          pose,
          style,
        }),
      },
    ],
  };

  console.log("Calling OpenAI (WeightVision chat) with model:", OPENAI_MODEL);

  const chatResp = await fetchWithTimeout(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify(chatPayload),
    },
    OPENAI_TIMEOUT_MS
  );

  if (!chatResp.ok) {
    const txt = await chatResp.text();
    console.error(
      "OpenAI /chat/completions (weight-vision) error:",
      chatResp.status,
      txt
    );
    throw new Error(`OpenAI weight-vision chat error: HTTP ${chatResp.status}`);
  }

  const chatRaw = (await chatResp.json()) as any;
  const chatMsg = chatRaw?.choices?.[0]?.message;

  let cfg: any;
  if (typeof chatMsg?.content === "string") {
    const content = chatMsg.content.trim();
    console.log("RAW_WEIGHT_VISION_CONTENT_START");
    console.log(content.slice(0, 1000));
    console.log("RAW_WEIGHT_VISION_CONTENT_END");
    cfg = JSON.parse(content);
  } else if (chatMsg?.parsed) {
    cfg = chatMsg.parsed;
  } else if (chatMsg?.content && typeof chatMsg.content === "object") {
    cfg = chatMsg.content;
  } else {
    throw new Error("OpenAI weight-vision chat missing JSON content");
  }

  const imagePrompt: string =
    cfg.image_prompt ||
    `Full-body ${gender || "person"} silhouette, ${height_cm} cm, ${weight_kg} kg, neutral stance, ${style}`;

  const morphTargets = {
    chest: clamp01(cfg?.morph_targets?.chest ?? 0.3),
    waist: clamp01(cfg?.morph_targets?.waist ?? 0.3),
    hips: clamp01(cfg?.morph_targets?.hips ?? 0.3),
    arms: clamp01(cfg?.morph_targets?.arms ?? 0.3),
    thighs: clamp01(cfg?.morph_targets?.thighs ?? 0.3),
  };

  // Now generate the actual silhouette image with DALL·E 3
  const imgPayload = {
    model: "dall-e-3",
    prompt: imagePrompt,
    n: 1,
    size: "1024x1024",
    response_format: "b64_json",
  };

  console.log("Calling OpenAI /images/generations for WeightVision");

  const imgResp = await fetchWithTimeout(
    "https://api.openai.com/v1/images/generations",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify(imgPayload),
    },
    OPENAI_TIMEOUT_MS
  );

  if (!imgResp.ok) {
    const txt = await imgResp.text();
    console.error(
      "OpenAI /images/generations error:",
      imgResp.status,
      txt
    );
    throw new Error(
      `OpenAI images.generation error: HTTP ${imgResp.status}`
    );
  }

  const imgRaw = (await imgResp.json()) as any;
  const imgData = Array.isArray(imgRaw?.data) ? imgRaw.data[0] : null;

  if (!imgData) {
    throw new Error("OpenAI images.generation returned no data entry");
  }

  const base64: string | undefined = imgData.b64_json;
  const image_url = base64
    ? `data:image/png;base64,${base64}`
    : imgData.url || "";

  if (!image_url) {
    throw new Error("OpenAI images.generation response missing image URL/data");
  }

  return {
    image_url,
    morph_targets: morphTargets,
    prompt_used: imagePrompt,
    pose,
    style,
  };
}

function clamp01(v: any): number {
  const n = typeof v === "number" ? v : Number(v);
  if (Number.isNaN(n)) return 0.3;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

// ======================================================================
//                      AI MEAL PLAN HANDLER + ENDPOINTS
// ======================================================================

async function handleAiMealPlan(req: Request, res: Response) {
  try {
    const constraints = req.body as UserConstraints;

    if (
      !constraints ||
      typeof constraints.dailyCalories !== "number" ||
      typeof constraints.proteinGrams !== "number" ||
      typeof constraints.carbsGrams !== "number" ||
      typeof constraints.fatsGrams !== "number"
    ) {
      return res.status(400).json({
        ok: false,
        error:
          "Invalid constraints. Expected dailyCalories, proteinGrams, carbsGrams, fatsGrams as numbers.",
      });
    }

    let weekPlan: WeekPlan;

    // AI only – no static fallback here
    try {
      weekPlan = await callOpenAiMealPlan(constraints);
      console.log("AI_WEEKPLAN_OK");
    } catch (err: any) {
      console.error("OpenAI meal plan generation failed:", err);

      const msg = String(err?.message || "");
      const lower = msg.toLowerCase();
      const isAbort =
        err?.name === "AbortError" ||
        lower.includes("aborted") ||
        lower.includes("timeout");

      return res.status(isAbort ? 504 : 500).json({
        ok: false,
        error: msg || "Failed while generating AI 7-day meal plan.",
      });
    }

    return res.status(200).json({
      ok: true,
      weekPlan,
      mode: "ai",
    });
  } catch (err: any) {
    console.error("Error in AI meal plan handler:", err);
    return res.status(500).json({
      ok: false,
      error: err?.message || "Failed to generate AI meal plan",
    });
  }
}

// ---------- SINGLE-DAY MEAL PLAN HANDLER (for split prompts) ----------
async function handleAiDayPlan(req: Request, res: Response) {
  try {
    const {
      constraints,
      day,
    }: {
      constraints: UserConstraints;
      day: {
        dayIndex: number;
        label: string;
        isoDate: string;
        meals: Array<{
          type: string;
          targets: {
            calories?: number;
            protein?: number;
            carbs?: number;
            fats?: number;
          };
        }>;
      };
    } = req.body;

    if (
      !constraints ||
      typeof constraints.dailyCalories !== "number" ||
      typeof constraints.proteinGrams !== "number" ||
      typeof constraints.carbsGrams !== "number" ||
      typeof constraints.fatsGrams !== "number"
    ) {
      return res.status(400).json({
        ok: false,
        error:
          "Invalid constraints for day-plan. Expected dailyCalories, proteinGrams, carbsGrams, fatsGrams as numbers.",
      });
    }

    if (!day || typeof day.dayIndex !== "number" || !Array.isArray(day.meals)) {
      return res.status(400).json({
        ok: false,
        error:
          "Invalid day payload. Expected { dayIndex, label, isoDate, meals[] }.",
      });
    }

    let result: { day: any; recipes: any[] };

    try {
      result = await callOpenAiDayPlan(constraints, day);
    } catch (err: any) {
      console.error("OpenAI single-day plan generation failed:", err);
      const msg = String(err?.message || "");
      const lower = msg.toLowerCase();
      const isAbort =
        err?.name === "AbortError" ||
        lower.includes("aborted") ||
        lower.includes("timeout");

      return res.status(isAbort ? 504 : 500).json({
        ok: false,
        error: msg || "Failed while generating AI day plan.",
      });
    }

    return res.status(200).json({
      ok: true,
      day: result.day,
      recipes: result.recipes || [],
    });
  } catch (err: any) {
    console.error("Error in AI day plan handler:", err);
    return res.status(500).json({
      ok: false,
      error: err?.message || "Failed to generate AI day plan",
    });
  }
}

// ---------- WEIGHT VISION HANDLER ----------
async function handleWeightVisionImage(req: Request, res: Response) {
  try {
    const body = req.body as Partial<WeightVisionRequest>;

    const height_cm = Number(body.height_cm);
    const weight_kg = Number(body.weight_kg);
    const gender = (body.gender || "").toString().trim();

    if (!Number.isFinite(height_cm) || !Number.isFinite(weight_kg) || !gender) {
      return res.status(400).json({
        ok: false,
        error:
          "Invalid body data. Expected numeric height_cm, weight_kg, and non-empty gender.",
      });
    }

    const waist_cm =
      typeof body.waist_cm === "number"
        ? body.waist_cm
        : body.waist_cm != null
        ? Number(body.waist_cm)
        : undefined;

    const body_fat =
      typeof body.body_fat === "number"
        ? body.body_fat
        : body.body_fat != null
        ? Number(body.body_fat)
        : undefined;

    const pose = body.pose || "front";
    const style =
      body.style || "simple fitness silhouette, neutral background";

    const result = await callOpenAiWeightVision({
      height_cm,
      weight_kg,
      waist_cm,
      gender,
      body_fat,
      pose,
      style,
    });

    return res.status(200).json({
      ok: true,
      ...result,
    });
  } catch (err: any) {
    console.error("Error in WeightVision image handler:", err);
    const msg = String(err?.message || "");
    const lower = msg.toLowerCase();
    const isAbort =
      err?.name === "AbortError" ||
      lower.includes("aborted") ||
      lower.includes("timeout");

    return res.status(isAbort ? 504 : 500).json({
      ok: false,
      error: msg || "Failed to generate weight-vision image",
    });
  }
}

app.post("/api/meal-plan", handleAiMealPlan);
app.post("/proxy/meal-plan", verifyAppProxy, handleAiMealPlan);

// NEW: per-day endpoints for split prompts
app.post("/api/day-plan", handleAiDayPlan);
app.post("/proxy/day-plan", verifyAppProxy, handleAiDayPlan);

// NEW: direct app-style paths (e.g. if frontend calls /apps/instacart/day-plan)
app.post("/apps/instacart/meal-plan", handleAiMealPlan);
app.post("/apps/instacart/day-plan", handleAiDayPlan);

// NEW: WEIGHT VISION IMAGE ENDPOINTS
app.post("/api/weight-vision/image", handleWeightVisionImage);
app.post("/proxy/weight-vision/image", verifyAppProxy, handleWeightVisionImage);
app.post("/apps/weight-vision/image", handleWeightVisionImage);

// POST /api/meal-plan/adjust
app.post("/api/meal-plan/adjust", (req: Request, res: Response) => {
  try {
    const { weekPlan, actualIntake } = req.body as {
      weekPlan: WeekPlan;
      actualIntake: Record<string, { caloriesDelta: number }>;
    };

    if (!weekPlan || !Array.isArray((weekPlan as any).days)) {
      return res.status(400).json({
        ok: false,
        error: "weekPlan with days[] is required.",
      });
    }

    if (!actualIntake || typeof actualIntake !== "object") {
      return res.status(400).json({
        ok: false,
        error: "actualIntake map is required.",
      });
    }

    const adjusted = adjustWeekPlan(weekPlan, actualIntake);
    return res.status(200).json({ ok: true, weekPlan: adjusted });
  } catch (err: any) {
    console.error("Error in /api/meal-plan/adjust:", err);
    return res.status(500).json({
      ok: false,
      error: err?.message || "Failed to adjust meal plan",
    });
  }
});

// POST /api/meal-plan/from-pantry
app.post("/api/meal-plan/from-pantry", async (req: Request, res: Response) => {
  try {
    const { constraints, pantry } = req.body as {
      constraints: UserConstraints;
      pantry: string[];
    };

    if (
      !constraints ||
      typeof constraints.dailyCalories !== "number" ||
      typeof constraints.budgetPerDay !== "number"
    ) {
      return res.status(400).json({
        ok: false,
        error:
          "Invalid constraints. Expect at least dailyCalories and budgetPerDay as numbers.",
      });
    }

    if (!Array.isArray(pantry)) {
      return res.status(400).json({
        ok: false,
        error: "pantry must be an array of strings.",
      });
    }

    let weekPlan: WeekPlan;
    try {
      weekPlan = await callOpenAiMealPlan(constraints, pantry);
    } catch (err) {
      console.error(
        "OpenAI pantry-based meal plan failed, using local fallback:",
        err
      );
      weekPlan = generateFromPantry(constraints, pantry);
    }

    return res.status(200).json({ ok: true, weekPlan });
  } catch (err: any) {
    console.error("Error in /api/meal-plan/from-pantry:", err);
    return res.status(500).json({
      ok: false,
      error: err?.message || "Failed to generate from pantry",
    });
  }
});

// ======================================================================
//                      INSTACART / APP PROXY ROUTES
// ======================================================================

interface HcItem {
  name: string;
  quantity?: number;
  unit?: string;
  category?: string;
  pantry?: boolean;
  displayText?: string;
  productIds?: number[];
  upcs?: string[];
  measurements?: Array<{ quantity?: number; unit?: string }>;
  filters?: {
    brand_filters?: string[];
    health_filters?: string[];
  };
}

interface HcRequestBody {
  meta?: any;
  days?: any[];
  items?: HcItem[];
  lineItems?: HcItem[];
  recipeLandingUrl?: string;
  retailerKey?: string | null;
}

// Root health
app.get("/", (_req: Request, res: Response) => {
  res.status(200).json({ ok: true, service: "heirclark-backend" });
});

// Simple open GET ping for App Proxy
app.get("/proxy/build-list", (req: Request, res: Response) => {
  res.status(200).json({
    ok: true,
    via: "app-proxy",
    ping: req.query.ping ?? null,
  });
});

// HMAC verification
function verifyAppProxy(req: Request, res: Response, next: NextFunction) {
  try {
    const secret = process.env.SHOPIFY_API_SECRET;
    if (!secret) {
      return res
        .status(500)
        .json({ ok: false, error: "Missing SHOPIFY_API_SECRET" });
    }

    const q: Record<string, unknown> = { ...req.query };
    const sig = String(q.signature || "");
    delete (q as any).signature;

    const ordered = Object.keys(q)
      .sort()
      .map((k) =>
        `${k}=${
          Array.isArray(q[k])
            ? (q[k] as any[]).join(",")
            : (q[k] ?? "").toString()
        }`
      )
      .join("");

    const hmac = crypto
      .createHmac("sha256", secret)
      .update(ordered, "utf8")
      .digest("hex");

    if (sig !== hmac) {
      return res.status(401).json({ ok: false, error: "Bad signature" });
    }

    next();
  } catch (err) {
    console.error("verifyAppProxy error", err);
    return res
      .status(500)
      .json({ ok: false, error: "verifyAppProxy crashed" });
  }
}

// Instacart retailers endpoint
app.get(
  "/proxy/retailers",
  verifyAppProxy,
  async (req: Request, res: Response) => {
    try {
      const apiKey = process.env.INSTACART_API_KEY;
      if (!apiKey) {
        console.error("Missing INSTACART_API_KEY");
        return res
          .status(500)
          .json({ ok: false, error: "Missing INSTACART_API_KEY" });
      }

      const apiBase =
        process.env.INSTACART_API_BASE ||
        "https://connect.dev.instacart.tools";

      const postalCode = String(req.query.postal_code || "").trim();
      const countryCode = String(req.query.country_code || "US")
        .trim()
        .toUpperCase();

      if (!postalCode) {
        return res.status(400).json({
          ok: false,
          error: "postal_code is required",
        });
      }

      const url =
        `${apiBase.replace(/\/$/, "")}/idp/v1/retailers` +
        `?postal_code=${encodeURIComponent(postalCode)}` +
        `&country_code=${encodeURIComponent(countryCode)}`;

      const resp = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
      });

      const txt = await resp.text();
      let data: any;
      try {
        data = JSON.parse(txt);
      } catch {
        data = null;
      }

      console.log("Instacart retailers status:", resp.status);
      console.log("Instacart retailers body:", txt);

      if (!resp.ok) {
        return res.status(resp.status).json({
          ok: false,
          error: "Failed to fetch retailers from Instacart",
          status: resp.status,
          details: data || txt,
        });
      }

      return res.status(200).json({
        ok: true,
        retailers: data?.retailers || [],
      });
    } catch (err) {
      console.error("Handler error in /proxy/retailers:", err);
      return res.status(500).json({
        ok: false,
        error: "Server error in /proxy/retailers",
      });
    }
  }
);

// ======================================================================
// OPTION C HELPER: FETCH A SINGLE PRODUCT DETAIL BY ID (for /proxy/instacart/return)
// ======================================================================

async function fetchInstacartProductDetail(productId: string) {
  const apiKey = process.env.INSTACART_API_KEY;
  if (!apiKey) {
    throw new Error("Missing INSTACART_API_KEY");
  }

  const apiBase =
    process.env.INSTACART_API_BASE || "https://connect.dev.instacart.tools";

  // NOTE: This path is PSEUDO-CODE – adjust based on Instacart Connect docs.
  // Example guess: /idp/v1/products/{product_uuid}
  const url = `${apiBase.replace(
    /\/$/,
    ""
  )}/idp/v1/products/${encodeURIComponent(productId)}`;

  console.log("[Instacart] Fetching product detail:", url);

  const resp = await fetchWithTimeout(
    url,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
    },
    15000
  );

  const txt = await resp.text();
  let data: any;
  try {
    data = JSON.parse(txt);
  } catch {
    data = null;
  }

  console.log("[Instacart] Product detail status:", resp.status);
  console.log("[Instacart] Product detail body:", txt);

  if (!resp.ok) {
    let msg = "";
    if (data && typeof data === "object") {
      if (data.error && typeof data.error === "object") {
        msg =
          data.error.message || JSON.stringify(data.error).slice(0, 200);
      } else {
        msg =
          data.error ||
          data.message ||
          (Array.isArray(data.errors) && data.errors[0]?.message) ||
          JSON.stringify(data).slice(0, 200);
      }
    } else {
      msg = txt.slice(0, 200);
    }
    if (!msg) msg = `HTTP ${resp.status}`;
    throw new Error(`Instacart product detail error: ${msg}`);
  }

  // Shape into a clean object for the frontend
  const product = {
    id: data.id ?? productId,
    name: data.name ?? data.title ?? "",
    price:
      typeof data.price === "number"
        ? data.price
        : typeof data.price_in_cents === "number"
        ? data.price_in_cents / 100
        : null,
    currency: data.currency ?? "USD",
    size: data.size ?? data.package_size ?? "",
    image_url:
      data.image_url ||
      (Array.isArray(data.images) && data.images.length > 0
        ? data.images[0]
        : ""),
    retailer_key: data.retailer_key,
    raw: data,
  };

  return product;
}

// ======================================================================
// NEW (OPTION C CORE): /proxy/instacart/return
// Instacart redirects here with product_id + your rowId.
// This page postMessages the selected product back to the main app window.
// ======================================================================

app.get("/proxy/instacart/return", async (req: Request, res: Response) => {
  try {
    const { product_id, rowId } = req.query;

    if (!product_id || typeof product_id !== "string") {
      return res
        .status(400)
        .send("Missing product_id from Instacart return URL.");
    }

    const safeRowId =
      typeof rowId === "string" && rowId.trim().length > 0
        ? rowId.trim()
        : `row-${Date.now()}`;

    let product: any;
    try {
      product = await fetchInstacartProductDetail(product_id);
    } catch (err) {
      console.error("[Instacart] Error fetching product detail:", err);
      // Even if product detail fails, send a minimal payload back
      product = {
        id: product_id,
        name: "",
        price: null,
        currency: "USD",
        size: "",
        image_url: "",
        raw_error: String((err as any)?.message || err),
      };
    }

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Heirclark · Instacart Selection</title>
</head>
<body>
  <script>
    (function () {
      var payload = {
        type: "HC_INSTACART_SELECTED",
        rowId: ${JSON.stringify(safeRowId)},
        product: ${JSON.stringify(product)}
      };

      try {
        if (window.opener && typeof window.opener.postMessage === "function") {
          // In production, restrict to your real origin, e.g.:
          // window.opener.postMessage(payload, "https://heirclark.com");
          window.opener.postMessage(payload, "*");
        } else if (window.parent && window.parent !== window && typeof window.parent.postMessage === "function") {
          window.parent.postMessage(payload, "*");
        }
      } catch (err) {
        console.error("Error posting Instacart selection back to opener:", err);
      }

      setTimeout(function () {
        window.close();
      }, 250);
    })();
  </script>
  <p>You can close this window.</p>
</body>
</html>
    `.trim();

    res.status(200).send(html);
  } catch (err) {
    console.error("[Instacart] /proxy/instacart/return error:", err);
    res
      .status(500)
      .send("There was a problem retrieving the product from Instacart.");
  }
});

// ======================================================================
// NEW: SIMPLE PER-ITEM INSTACART SEARCH (for “CHECK PRICE ON INSTACART”)
// ======================================================================

// ✅ Shared handler used for both /api/instacart/search and /proxy/instacart/search
async function instacartSearchHandler(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const apiKey = process.env.INSTACART_API_KEY;
    if (!apiKey) {
      console.error("Missing INSTACART_API_KEY");
      res.status(500).json({ ok: false, error: "Missing INSTACART_API_KEY" });
      return;
    }

    const apiBase =
      process.env.INSTACART_API_BASE || "https://connect.dev.instacart.tools";

    const { query, retailerKey, recipeLandingUrl } = req.body as {
      query?: string;
      retailerKey?: string | null;
      recipeLandingUrl?: string;
    };

    const q = (query || "").trim();
    if (!q) {
      res.status(400).json({
        ok: false,
        error: "query is required (e.g., 'SALMON')",
      });
      return;
    }

    // 🔁 Always have a public fallback URL ready
    const fallbackSearchUrl =
      "https://www.instacart.com/store/search?q=" + encodeURIComponent(q);

    console.log("Instacart per-item search for:", q);

    const lineItems = [
      {
        name: q,
        quantity: 1,
        unit: "each",
        display_text: q,
      },
    ];

    const instacartBody: any = {
      title: `Heirclark: ${q}`,
      link_type: "shopping_list",
      instructions: [`Quick price check from Heirclark for: ${q}.`],
      line_items: lineItems,
    };

    const partnerLinkbackUrl =
      typeof recipeLandingUrl === "string" && recipeLandingUrl.trim()
        ? recipeLandingUrl.trim()
        : undefined;

    if (partnerLinkbackUrl) {
      instacartBody.landing_page_configuration = {
        partner_linkback_url: partnerLinkbackUrl,
      };
    }

    if (retailerKey) {
      instacartBody.metadata = {
        ...(instacartBody.metadata || {}),
        heirclark_retailer_key: retailerKey,
      };
    }

    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    };

    const resp = await fetch(
      `${apiBase.replace(/\/$/, "")}/idp/v1/products/products_link`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(instacartBody),
      }
    );

    const text = await resp.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }

    console.log("Instacart per-item products_link status:", resp.status);
    console.log("Instacart per-item products_link body:", text);

    // ❌ If Instacart API errors, fall back to generic search URL
    if (!resp.ok) {
      let message = "";

      if (data && typeof data === "object") {
        if (data.error && typeof data.error === "object") {
          message =
            data.error.message || JSON.stringify(data.error).slice(0, 200);
        } else {
          message =
            data.error ||
            data.message ||
            (Array.isArray(data.errors) &&
              data.errors[0]?.message) ||
            JSON.stringify(data).slice(0, 200);
        }
      } else if (typeof text === "string") {
        message = text.slice(0, 200);
      }

      if (!message) {
        message = `HTTP ${resp.status}`;
      }

      console.error(
        "Instacart per-item products_link error – using fallback search URL:",
        message
      );

      // ✅ STILL return ok:true with a usable URL
      res.status(200).json({
        ok: true,
        products_link_url: fallbackSearchUrl,
        note: "fallback_search_url",
        error: `Instacart: ${message}`,
        status: resp.status,
      });
      return;
    }

    const productsLinkUrl = data?.products_link_url;

    // ❗ If Instacart didn’t include products_link_url, ALSO fall back
    if (!productsLinkUrl || typeof productsLinkUrl !== "string") {
      console.warn(
        "Instacart did not return products_link_url, using fallback search URL"
      );

      res.status(200).json({
        ok: true,
        products_link_url: fallbackSearchUrl,
        note: "fallback_search_url_no_products_link",
      });
      return;
    }

    // 🎯 Happy path – we got a real Instacart products_link_url
    res.status(200).json({
      ok: true,
      products_link_url: productsLinkUrl,
    });
  } catch (err) {
    console.error("Handler error in Instacart search:", err);

    // Last-resort: still give the public search URL instead of a hard error
    const body = req.body as { query?: string };
    const rawQ = (body?.query || "").trim();
    const fallbackSearchUrl = rawQ
      ? "https://www.instacart.com/store/search?q=" +
        encodeURIComponent(rawQ)
      : "https://www.instacart.com/store";

    res.status(200).json({
      ok: true,
      products_link_url: fallbackSearchUrl,
      note: "fallback_search_url_on_server_error",
    });
  }
}

// ✅ Public JSON API for your Step 2 JS (hc-chef-budget-planner.js)
app.post("/api/instacart/search", instacartSearchHandler);

// ✅ Alias under /proxy if you ever want to hit it that way
app.post("/proxy/instacart/search", instacartSearchHandler);

// Instacart build-list endpoint
app.post(
  "/proxy/build-list",
  verifyAppProxy,
  async (req: Request, res: Response) => {
    try {
      const apiKey = process.env.INSTACART_API_KEY;
      if (!apiKey) {
        console.error("Missing INSTACART_API_KEY");
        return res
          .status(500)
          .json({ ok: false, error: "Missing INSTACART_API_KEY" });
      }

      const apiBase =
        process.env.INSTACART_API_BASE ||
        "https://connect.dev.instacart.tools";

      console.log(
        "Using Instacart API base:",
        apiBase,
        " key prefix:",
        apiKey.slice(0, 6)
      );

      const body = req.body as HcRequestBody;
      console.log("POST /proxy/build-list body:", JSON.stringify(body));

      const items: HcItem[] = Array.isArray(body.items) ? body.items : [];
      const lineItemsSource: HcItem[] =
        Array.isArray(body.lineItems) && body.lineItems.length
          ? body.lineItems
          : items;

      if (!lineItemsSource.length) {
        return res.status(400).json({
          ok: false,
          error: "No lineItems or items provided from frontend.",
        });
      }

      const instacartLineItems = lineItemsSource
        .filter((i) => i && i.name)
        .map((item) => ({
          name: item.name,
          quantity:
            typeof item.quantity === "number" && item.quantity > 0
              ? item.quantity
              : 1,
          unit: item.unit || "each",
          display_text: item.displayText || item.name,
          product_ids: item.productIds,
          upcs: item.upcs,
          line_item_measurements: item.measurements?.map((m) => ({
            quantity:
              typeof m.quantity === "number" && m.quantity > 0 ? m.quantity : 1,
            unit: m.unit || "each",
          })),
          filters: item.filters,
        }));

      if (!instacartLineItems.length) {
        return res.status(400).json({
          ok: false,
          error: "No valid line items after mapping.",
        });
      }

      const partnerLinkbackUrl = body.recipeLandingUrl;
      const retailerKey = body.retailerKey || null;

      const instacartBody: any = {
        title: "Heirclark 7-Day Nutrition Plan",
        link_type: "shopping_list",
        instructions: [
          "Built from your Heirclark Wellness Plan 7-day nutrition recommendations.",
        ],
        line_items: instacartLineItems,
      };

      if (partnerLinkbackUrl) {
        instacartBody.landing_page_configuration = {
          partner_linkback_url: partnerLinkbackUrl,
        };
      }

      if (retailerKey) {
        instacartBody.metadata = {
          ...(instacartBody.metadata || {}),
          heirclark_retailer_key: retailerKey,
        };
      }

      const headers: Record<string, string> = {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      };

      const productsResp = await fetch(
        `${apiBase.replace(/\/$/, "")}/idp/v1/products/products_link`,
        {
          method: "POST",
          headers,
          body: JSON.stringify(instacartBody),
        }
      );

      const productsText = await productsResp.text();
      let productsData: any;
      try {
        productsData = JSON.parse(productsText);
      } catch {
        productsData = null;
      }

      console.log("Instacart products_link status:", productsResp.status);
      console.log("Instacart products_link body:", productsText);

      if (!productsResp.ok) {
        let message = "";

        if (productsResp.status === 403) {
          message =
            "Forbidden – your Instacart API key or account is not authorized to use the shopping list endpoint. " +
            "Please confirm that Product Links / Shopping List Pages are enabled for this key.";
        } else if (productsData && typeof productsData === "object") {
          if (productsData.error && typeof productsData.error === "object") {
            message =
              productsData.error.message ||
              JSON.stringify(productsData.error).slice(0, 200);
          } else {
            message =
              productsData.error ||
              productsData.message ||
              (Array.isArray(productsData.errors) &&
                productsData.errors[0]?.message) ||
              JSON.stringify(productsData).slice(0, 200);
          }
        } else if (typeof productsText === "string") {
          message = productsText.slice(0, 200);
        }

        if (!message) {
          message = `HTTP ${productsResp.status}`;
        }

        return res.status(productsResp.status).json({
          ok: false,
          error: `Instacart: ${message}`,
          status: productsResp.status,
          details: productsData || productsText,
        });
      }

      const productsLinkUrl = productsData?.products_link_url;
      if (!productsLinkUrl) {
        return res.status(500).json({
          ok: false,
          error: "Instacart did not return products_link_url",
          details: productsData || productsText,
        });
      }

      // Optional: recipe endpoint
      let recipeProductsLinkUrl: string | null = null;
      let recipeError: string | null = null;

      try {
        const instacartLineItemsForRecipe = instacartLineItems;

        const recipeIngredients = instacartLineItemsForRecipe.map((li) => ({
          name: li.name,
          display_text: li.display_text,
          product_ids: li.product_ids,
          upcs: li.upcs,
          measurements:
            li.line_item_measurements && li.line_item_measurements.length
              ? li.line_item_measurements.map((m) => ({
                  quantity: m.quantity,
                  unit: m.unit,
                }))
              : [
                  {
                    quantity: li.quantity ?? 1,
                    unit: li.unit || "each",
                  },
                ],
          filters: li.filters,
        }));

        const meta = body.meta || {};
        const recipeTitle =
          typeof meta.recipeTitle === "string" && meta.recipeTitle.trim()
            ? meta.recipeTitle.trim()
            : "Heirclark 7-Day Nutrition Plan";

        const recipeInstructions: string[] = Array.isArray(
          meta.recipeInstructions
        )
          ? meta.recipeInstructions.map((s: any) => String(s))
          : [
              "Built from your Heirclark Wellness Plan 7-day nutrition recommendations.",
            ];

        const recipePayload: any = {
          title: recipeTitle,
          ingredients: recipeIngredients,
          instructions: recipeInstructions,
        };

        if (typeof meta.servings === "number" && meta.servings > 0) {
          recipePayload.servings = meta.servings;
        }

        if (typeof meta.cooking_time === "number" && meta.cooking_time > 0) {
          recipePayload.cooking_time = meta.cooking_time;
        }

        if (typeof meta.author === "string" && meta.author.trim().length > 0) {
          recipePayload.author = meta.author.trim();
        }

        if (
          typeof meta.image_url === "string" &&
          meta.image_url.trim().length > 0
        ) {
          recipePayload.image_url = meta.image_url.trim();
        }

        if (
          typeof meta.external_reference_id === "string" &&
          meta.external_reference_id.trim().length > 0
        ) {
          recipePayload.external_reference_id =
            meta.external_reference_id.trim();
        }

        if (
          typeof meta.content_creator_credit_info === "string" &&
          meta.content_creator_credit_info.trim().length > 0
        ) {
          recipePayload.content_creator_credit_info =
            meta.content_creator_credit_info.trim();
        }

        if (
          typeof meta.expires_in === "number" &&
          meta.expires_in > 0 &&
          meta.expires_in <= 365
        ) {
          recipePayload.expires_in = meta.expires_in;
        }

        if (partnerLinkbackUrl) {
          recipePayload.landing_page_configuration = {
            partner_linkback_url: partnerLinkbackUrl,
            enable_pantry_items: true,
          };
        }

        const recipeResp = await fetch(
          `${apiBase.replace(/\/$/, "")}/idp/v1/products/recipe`,
          {
            method: "POST",
            headers,
            body: JSON.stringify(recipePayload),
          }
        );

        const recipeText = await recipeResp.text();
        let recipeData: any;
        try {
          recipeData = JSON.parse(recipeText);
        } catch {
          recipeData = null;
        }

        console.log("Instacart recipe status:", recipeResp.status);
        console.log("Instacart recipe body:", recipeText);

        if (!recipeResp.ok) {
          let msg = "";

          if (recipeData && typeof recipeData === "object") {
            if (recipeData.error && typeof recipeData.error === "object") {
              msg =
                recipeData.error.message ||
                JSON.stringify(recipeData.error).slice(0, 200);
            } else {
              msg =
                recipeData.error ||
                recipeData.message ||
                (Array.isArray(recipeData.errors) &&
                  recipeData.errors[0]?.message) ||
                JSON.stringify(recipeData);
            }
          } else if (typeof recipeText === "string") {
            msg = recipeText.slice(0, 200);
          }

          if (!msg) {
            msg = `HTTP ${recipeResp.status}`;
          }

          recipeError = `Instacart recipe error: ${msg}`;
        } else {
          const maybeRecipeUrl = recipeData?.products_link_url;
          if (maybeRecipeUrl && typeof maybeRecipeUrl === "string") {
            recipeProductsLinkUrl = maybeRecipeUrl;
          } else {
            recipeError =
              "Instacart recipe endpoint did not return products_link_url";
          }
        }
      } catch (err) {
        console.error("Error calling Instacart /products/recipe:", err);
        recipeError = "Server error while calling Instacart recipe endpoint";
      }

      return res.status(200).json({
        ok: true,
        products_link_url: productsLinkUrl,
        recipe_products_link_url: recipeProductsLinkUrl,
        ...(recipeError ? { recipe_error: recipeError } : {}),
      });
    } catch (err) {
      console.error("Handler error in /proxy/build-list:", err);
      return res.status(500).json({
        ok: false,
        error: "Server error in /proxy/build-list",
      });
    }
  }
);

// ======================================================================
//                      START SERVER
// ======================================================================

app.listen(PORT, () => {
  console.log(`Heirclark backend listening on port ${PORT}`);
});
