import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import cors from "cors";
import morgan from "morgan";

// Types / services
import { UserConstraints, WeekPlan } from "./types/mealPlan";
import {
  generateWeekPlan,
  adjustWeekPlan,
  generateFromPantry,
} from "./services/mealPlanner";

// 🔥 Calorie / nutrition feature routers
import { mealsRouter } from "./routes/meals";
import { nutritionRouter } from "./routes/nutrition";
import { hydrationRouter } from "./routes/hydration";
import { weightRouter } from "./routes/weight";

const app = express();
const PORT = process.env.PORT || 3000;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS || 25000); // 25s

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

// ✅ Simple health check: should respond at
// https://heirclarkinstacartbackend-production.up.railway.app/
app.get("/", (_req: Request, res: Response) => {
  res.status(200).json({ ok: true, service: "heirclark-backend" });
});

// ✅ Mount calorie / nutrition routes
// These give you:
//   POST /api/v1/nutrition/meal
//   GET  /api/v1/nutrition/day-summary
//   + whatever is in the other routers
app.use("/api/v1/meals", mealsRouter);
app.use("/api/v1/nutrition", nutritionRouter);
app.use("/api/v1/hydration", hydrationRouter);
app.use("/api/v1/weight", weightRouter);

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

// ... 🔽 everything below here is exactly what you already had
// (AI meal-plan helpers, WeightVision, Instacart handlers, etc.)

// Call OpenAI to build a WeekPlan that includes days[] + recipes[]
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

  // ... (rest of your existing code unchanged)
}

// (KEEP all the rest of your handlers exactly as-is)

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

export default app; // (optional, but nice for testing)
