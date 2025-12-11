import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import cors from "cors";
import morgan from "morgan";
import multer from "multer";

// Types / services
import { UserConstraints } from "./types/mealPlan";
import {
  generateWeekPlan,
  adjustWeekPlan,
  generateFromPantry,
} from "./services/mealPlanner";

// Calorie / nutrition feature routers
import { mealsRouter } from "./routes/meals";
import { nutritionRouter } from "./routes/nutrition";
import { hydrationRouter } from "./routes/hydration";
import { weightRouter } from "./routes/weight";

// ⭐ NEW: Body Scan router (Tier 3 SMPL-X microservice proxy)
import { bodyScanRouter } from "./routes/bodyScan";

const app = express();
const PORT = process.env.PORT || 3000;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS || 25000); // 25s

// Multer instance for in-memory file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 8 * 1024 * 1024, // 8 MB
  },
});

// Helper type so TS knows about req.file
type MulterRequest = Request & { file?: any };

// ======================================================================
//                     CORE MIDDLEWARE (CORS, LOGGING, BODY)
// ======================================================================

app.use(
  cors({
    origin: true, // later you can lock this to your Shopify domain
    methods: ["GET", "POST", "OPTIONS", "DELETE", "PUT", "PATCH"],
    allowedHeaders: ["Content-Type"],
  })
);

// Preflight
app.options("*", cors());

// Logging
app.use(morgan("dev"));

// JSON/body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ======================================================================
//                       HEALTH CHECK + NUTRITION ROUTES
// ======================================================================

// Simple health check
app.get("/", (_req: Request, res: Response) => {
  res.status(200).json({ ok: true, service: "heirclark-backend" });
});

// Mount calorie / nutrition routes
app.use("/api/v1/meals", mealsRouter);
app.use("/api/v1/nutrition", nutritionRouter);
app.use("/api/v1/hydration", hydrationRouter);
app.use("/api/v1/weight", weightRouter);

// ⭐ NEW: Body Scan (front/side/back photos → SMPL-X microservice)
// This middleware ensures requests to the bodyScanRouter have
// req.files.front / req.files.side / req.files.back populated.
const bodyScanUpload = upload.fields([
  { name: "front", maxCount: 1 },
  { name: "side", maxCount: 1 },
  { name: "back", maxCount: 1 },
]);

// The bodyScanRouter itself should define the route path, e.g.
// router.post("/api/v1/body-scan", ...)
app.use(bodyScanUpload, bodyScanRouter);

// ======================================================================
//                         OPENAI HELPERS
// ======================================================================

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

// ======================================================================
//          AI PHOTO → NUTRITION ENDPOINT (Guess from Food Photo)
// ======================================================================

app.post(
  "/api/ai/guess-nutrition-from-photo",
  upload.single("image"),
  async (req: MulterRequest, res: Response) => {
    try {
      if (!OPENAI_API_KEY) {
        console.warn("OPENAI_API_KEY is not set – cannot call OpenAI.");
        return res.status(500).json({
          ok: false,
          error: "OPENAI_API_KEY is not configured",
        });
      }

      if (!req.file || !req.file.buffer) {
        return res.status(400).json({
          ok: false,
          error: "Image file is required (field name: 'image')",
        });
      }

      const mimeType = req.file.mimetype || "image/jpeg";
      const base64 = req.file.buffer.toString("base64");

      const systemPrompt = `
You are a nutrition assistant for a calorie tracking app.

Given a single food photo, you must:
1. Infer a short human-readable meal name.
2. Estimate total calories, protein (g), carbs (g), and fat (g) for the plate in the photo.
3. Provide a confidence score from 0–100 (where 100 means very confident).
4. Break down the plate into a list of component foods with approximate macros.
5. Suggest 1–3 realistic, healthier swaps (e.g., 'swap fries for roasted potatoes', 'use grilled chicken instead of fried').

Respond ONLY as valid JSON with this exact shape:

{
  "mealName": string,
  "calories": number,
  "protein": number,
  "carbs": number,
  "fats": number,
  "confidence": number,          // 0–100
  "foods": [
    {
      "name": string,
      "calories": number,
      "protein": number,
      "carbs": number,
      "fats": number
    }
  ],
  "swaps": string[],             // list of short healthier swap suggestions
  "explanation": string          // 1–3 short sentences explaining your estimate
}
`.trim();

      const body = {
        model: OPENAI_MODEL, // must be a vision-capable model, e.g. "gpt-4.1" or "gpt-4.1-mini"
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Estimate the nutrition for this meal photo.",
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:${mimeType};base64,${base64}`,
                },
              },
            ],
          },
        ],
      };

      const openaiResp = await fetchWithTimeout(
        "https://api.openai.com/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${OPENAI_API_KEY}`,
          },
          body: JSON.stringify(body),
        },
        OPENAI_TIMEOUT_MS
      );

      const json = await openaiResp.json();
      if (!openaiResp.ok) {
        console.error("OpenAI error:", openaiResp.status, json);
        return res.status(500).json({
          ok: false,
          error:
            json?.error?.message ||
            `OpenAI API error (status ${openaiResp.status})`,
        });
      }

      const rawContent = json?.choices?.[0]?.message?.content;
      if (typeof rawContent !== "string") {
        console.error("Unexpected OpenAI content:", rawContent);
        return res.status(500).json({
          ok: false,
          error: "Unexpected OpenAI response format",
        });
      }

      let parsed: any;
      try {
        parsed = JSON.parse(rawContent);
      } catch (e) {
        console.error("Failed to parse OpenAI JSON content:", rawContent);
        return res.status(500).json({
          ok: false,
          error: "Failed to parse AI nutrition JSON",
          raw: rawContent,
        });
      }

      const mealName =
        typeof parsed.mealName === "string" ? parsed.mealName : "Meal";

      const calories = Number(parsed.calories) || 0;
      const protein = Number(parsed.protein) || 0;
      const carbs = Number(parsed.carbs) || 0;
      const fats = Number(parsed.fats ?? parsed.fat ?? 0) || 0;

      const confidence = Math.max(
        0,
        Math.min(100, Number(parsed.confidence) || 0)
      );

      const foods = Array.isArray(parsed.foods)
        ? parsed.foods
            .map((f: any) => ({
              name: String(f.name || "").trim() || "Food item",
              calories: Number(f.calories) || 0,
              protein: Number(f.protein) || 0,
              carbs: Number(f.carbs) || 0,
              fats: Number(f.fats ?? f.fat ?? 0) || 0,
            }))
            .filter((f: any) => f.name)
        : [];

      const swaps = Array.isArray(parsed.swaps)
        ? parsed.swaps.map((s: any) => String(s)).filter(Boolean)
        : [];

      const explanation =
        typeof parsed.explanation === "string" ? parsed.explanation : "";

      return res.status(200).json({
        ok: true,
        mealName,
        calories,
        protein,
        carbs,
        fats,
        confidence,
        foods,
        swaps,
        explanation,
      });
    } catch (err: any) {
      console.error("AI nutrition estimation failed:", err);
      return res.status(500).json({
        ok: false,
        error: err?.message || "AI nutrition estimation failed",
      });
    }
  }
);

// ======================================================================
//          (REST OF YOUR EXISTING OPENAI MEAL PLAN LOGIC)
// ======================================================================

// Call OpenAI to build a WeekPlan that includes days[] + recipes[]
async function callOpenAiMealPlan(
  constraints: UserConstraints,
  pantry?: string[]
) {
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
                              anyOf: [{ type: "number" }, { type: "string" }],
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
                                anyOf: [{ type: "number" }, { type: "string" }],
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
                            filters: { type: "object" },
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

  // TODO: implement actual OpenAI call + map into WeekPlan
  // left as-is so it doesn't break existing imports
  return payload;
}

// ======================================================================
//                      GLOBAL ERROR HANDLER
// ======================================================================

app.use(
  (err: any, _req: Request, res: Response, _next: NextFunction) => {
    console.error("Unhandled error:", err);
    res.status(500).json({
      ok: false,
      error: err?.message || "Internal server error",
    });
  }
);

// ======================================================================
//                      START SERVER
// ======================================================================

app.listen(PORT, () => {
  console.log(`Heirclark backend listening on port ${PORT}`);
});

export default app;
