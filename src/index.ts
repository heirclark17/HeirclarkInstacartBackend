import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
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

// ⭐ Body Scan router (Tier 3 SMPL-X microservice proxy)
import { bodyScanRouter } from "./routes/bodyScan";

// ✅ Fitbit integration router
import fitbitRouter from "./routes/fitbit";

// ✅ Existing: Apple Health bridge router (link + sync + today)
import { appleHealthRouter } from "./routes/appleHealth";

// ✅ NEW: Website ↔ iPhone Shortcut Health Bridge router
import { healthBridgeRouter } from "./routes/healthBridge";

const app = express();
const PORT = Number(process.env.PORT || 3000);

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS || 25000); // 25s

// Multer instance for in-memory file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB
});

// Helper type so TS knows about req.file
type MulterRequest = Request & { file?: Express.Multer.File };

// ======================================================================
//                     CORE MIDDLEWARE (CORS, LOGGING, BODY)
// ======================================================================

// ✅ CORS — allow Shopify storefront + local dev
const allowlist = new Set<string>([
  "https://heirclark.com",
  "https://www.heirclark.com",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

app.use(
  cors({
    origin: (origin, cb) => {
      // Allow server-to-server/no-origin requests
      if (!origin) return cb(null, true);
      if (allowlist.has(origin)) return cb(null, true);
      return cb(new Error(`CORS blocked: ${origin}`));
    },
    methods: ["GET", "POST", "OPTIONS", "DELETE", "PUT", "PATCH"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "Accept",
      "X-Shopify-Customer-Id",
    ],
    credentials: true,
  })
);

// ✅ Preflight (important for multipart uploads)
app.options("*", cors());

// Logging
app.use(morgan("dev"));

// JSON/body parsing
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// ======================================================================
//                       HEALTH CHECK + ROUTES
// ======================================================================

app.get("/", (_req: Request, res: Response) => {
  res.status(200).json({ ok: true, service: "heirclark-backend" });
});

app.get("/health", (_req: Request, res: Response) => {
  res.status(200).send("ok");
});

// Mount calorie / nutrition routes
app.use("/api/v1/meals", mealsRouter);
app.use("/api/v1/nutrition", nutritionRouter);
app.use("/api/v1/hydration", hydrationRouter);
app.use("/api/v1/weight", weightRouter);

// ✅ Fitbit integration routes (OAuth + token refresh + today activity)
app.use("/api/v1/integrations/fitbit", fitbitRouter);

// ✅ Existing: Apple Health bridge routes
app.use("/api/v1/wearables/apple", appleHealthRouter);

// ✅ NEW: Shortcut-based Health Bridge
app.use("/api/v1/health", healthBridgeRouter);

// ======================================================================
//                       BODY SCAN ROUTE (CORRECT MULTER SCOPE)
// ======================================================================

const bodyScanUpload = upload.fields([
  { name: "front", maxCount: 1 },
  { name: "side", maxCount: 1 },
  { name: "back", maxCount: 1 },
]);

app.use("/api/v1/body-scan", bodyScanUpload, bodyScanRouter);

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

  return fetch(url, { ...options, signal: controller.signal }).finally(() =>
    clearTimeout(id)
  );
}

// ======================================================================
//      AI PHOTO → NUTRITION HANDLER (shared by multiple route aliases)
// ======================================================================

async function handleGuessNutritionFromPhoto(req: MulterRequest, res: Response) {
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
        error: "Image file is required (field name: 'image' or 'photo')",
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
5. Suggest 1–3 realistic, healthier swaps.

Respond ONLY as valid JSON with this exact shape:

{
  "mealName": string,
  "calories": number,
  "protein": number,
  "carbs": number,
  "fats": number,
  "confidence": number,
  "foods": [
    { "name": string, "calories": number, "protein": number, "carbs": number, "fats": number }
  ],
  "swaps": string[],
  "explanation": string
}
`.trim();

    const body = {
      model: OPENAI_MODEL,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: "Estimate the nutrition for this meal photo." },
            {
              type: "image_url",
              image_url: { url: `data:${mimeType};base64,${base64}` },
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
          Accept: "application/json",
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
    } catch {
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

// ======================================================================
//          AI PHOTO ROUTES (aliases to match your frontend JS)
// ======================================================================

// ✅ Supports BOTH field names ("image" and "photo") in case your JS changes
const uploadImage = upload.single("image");
const uploadPhoto = upload.single("photo");

// ✅ Your existing route (keep)
app.post("/api/ai/guess-nutrition-from-photo", uploadImage, handleGuessNutritionFromPhoto);

// ✅ Add aliases that your JS is calling (prevents 404)
app.post("/api/v1/nutrition/ai/meal-from-photo", uploadImage, handleGuessNutritionFromPhoto);
app.post("/api/v1/nutrition/ai/photo", uploadImage, handleGuessNutritionFromPhoto);
app.post("/api/v1/nutrition/ai/photo-estimate", uploadImage, handleGuessNutritionFromPhoto);
app.post("/api/v1/ai/meal-photo", uploadImage, handleGuessNutritionFromPhoto);

// Optional extra safety: accept "photo" field too
app.post("/api/v1/nutrition/ai/meal-from-photo", uploadPhoto, handleGuessNutritionFromPhoto);
app.post("/api/v1/nutrition/ai/photo", uploadPhoto, handleGuessNutritionFromPhoto);
app.post("/api/v1/nutrition/ai/photo-estimate", uploadPhoto, handleGuessNutritionFromPhoto);
app.post("/api/v1/ai/meal-photo", uploadPhoto, handleGuessNutritionFromPhoto);

// ======================================================================
//          (REST OF YOUR EXISTING OPENAI MEAL PLAN LOGIC)
// ======================================================================

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
                  tags: { type: "array", items: { type: "string" } },
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
                            upcs: { type: "array", items: { type: "string" } },
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

  return payload;
}

// ======================================================================
//                 NOT FOUND HANDLER (clean JSON 404)
// ======================================================================

app.use((req: Request, res: Response) => {
  res.status(404).json({
    ok: false,
    error: "Not Found",
    path: req.originalUrl,
    method: req.method,
  });
});

// ======================================================================
//                      GLOBAL ERROR HANDLER
// ======================================================================

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Unhandled error:", err);
  res.status(500).json({
    ok: false,
    error: err?.message || "Internal server error",
  });
});

// ======================================================================
//                      START SERVER
// ======================================================================

app.listen(PORT, () => {
  console.log(`Heirclark backend listening on port ${PORT}`);
});

export default app;
