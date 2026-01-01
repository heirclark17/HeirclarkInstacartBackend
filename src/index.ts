import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import morgan from "morgan";
import multer from "multer";

// Middleware
import { rateLimitMiddleware } from "./middleware/rateLimiter";
import { sendError } from "./middleware/responseHelper";
import { auditMiddleware } from "./middleware/auditMiddleware";

// Security & Compliance
import { validateEncryptionConfig } from "./services/encryption";
import { auditLogger } from "./services/auditLogger";
import { scheduleRetentionJob } from "./jobs/dataRetention";

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

// User preferences router
import { preferencesRouter } from "./routes/preferences";

// Body Scan router (Tier 3 SMPL-X microservice proxy)
import { bodyScanRouter } from "./routes/bodyScan";

// Fitbit integration router
import fitbitRouter from "./routes/fitbit";

// Apple Health bridge router (link + sync + today)
import { appleHealthRouter } from "./routes/appleHealth";

// Website ↔ iPhone Shortcut Health Bridge router
import { healthBridgeRouter } from "./routes/healthBridge";

// ✅ User preferences / goals router
import { userRouter } from "./routes/user";

// Instacart router
import instacartRouter from "./routes/instacart";

// HeyGen video generation router
import { heygenRouter } from "./routes/heygen";

// GDPR compliance router
import { gdprRouter } from "./routes/gdpr";

// RAG (Retrieval-Augmented Generation) router
import ragRouter from "./routes/rag";

// AI Backgrounds router
import aiBackgroundsRouter from "./routes/aiBackgrounds";

// Validate environment at startup
function validateStartupEnvironment(): void {
  const required = ["DATABASE_URL"];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(", ")}`);
    process.exit(1);
  }

  // Warnings for optional but recommended variables
  const recommended = [
    { key: "JWT_SECRET", fallback: "Using insecure default" },
    { key: "OPENAI_API_KEY", fallback: "AI features will not work" },
    { key: "HC_APPLE_SYNC_SIGNING_SECRET", fallback: "Apple Health sync insecure" },
    { key: "HEYGEN_API_KEY", fallback: "HeyGen video generation will not work" },
    { key: "ANTHROPIC_API_KEY", fallback: "Script generation will not work" },
    { key: "ENCRYPTION_KEY", fallback: "Data encryption disabled (generate with: openssl rand -base64 32)" },
  ];

  // Validate encryption key if present
  const encryptionCheck = validateEncryptionConfig();
  if (!encryptionCheck.valid) {
    console.warn(`WARNING: Encryption not configured: ${encryptionCheck.error}`);
  } else {
    console.log("✓ Encryption key validated");
  }

  for (const { key, fallback } of recommended) {
    if (!process.env[key]) {
      console.warn(`WARNING: ${key} not set. ${fallback}`);
    }
  }
}

validateStartupEnvironment();

const app = express();
const PORT = Number(process.env.PORT || 3000);

// Multer instance for in-memory file uploads (used for body-scan only here)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB
});

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
      "X-Correlation-Id",
      "X-Confirm-Delete",  // GDPR deletion confirmation
      "Cache-Control",
      "Pragma",
    ],
    credentials: true,
  })
);

// ✅ Preflight (important for multipart uploads)
app.options("*", cors());

// Logging
app.use(morgan("dev"));

// Audit logging (SOC2 compliance)
app.use(auditMiddleware());

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

// Apply global rate limiting
app.use(rateLimitMiddleware());

// Mount calorie / nutrition routes
app.use("/api/v1/meals", mealsRouter);
app.use("/api/v1/nutrition", nutritionRouter);
app.use("/api/v1/hydration", hydrationRouter);
app.use("/api/v1/weight", weightRouter);

// User preferences routes
app.use("/api/v1/preferences", preferencesRouter);

// Fitbit integration routes (OAuth + token refresh + today activity)
app.use("/api/v1/integrations/fitbit", fitbitRouter);

// Apple Health bridge routes
app.use("/api/v1/wearables/apple", appleHealthRouter);

// Shortcut-based Health Bridge
app.use("/api/v1/health", healthBridgeRouter);

// ✅ User preferences / goals
app.use("/api/v1/user", userRouter);

// Instacart routes
app.use("/api", instacartRouter);

// HeyGen video generation routes
app.use("/api/v1/video", heygenRouter);

// GDPR compliance routes (data export, deletion, retention policy)
app.use("/api/v1/gdpr", gdprRouter);

// RAG routes (top foods discovery, document management, search)
app.use("/api/v1/rag", ragRouter);

// AI Backgrounds routes (card customization)
app.use("/api/v1/ai-backgrounds", aiBackgroundsRouter);

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
//          (REST OF YOUR EXISTING OPENAI MEAL PLAN LOGIC)
// ======================================================================
// NOTE: Leaving your existing meal-planner logic in place.
// If you had additional endpoints below in your real file, keep them here.
// (Your pasted file shows only the helper payload builder — not mounted routes.)

async function callOpenAiMealPlan(
  constraints: UserConstraints,
  pantry?: string[]
) {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
  const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

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

// Custom error types
interface AppError extends Error {
  statusCode?: number;
  code?: string;
  field?: string;
}

app.use((err: AppError, _req: Request, res: Response, _next: NextFunction) => {
  // Log error (but not in tests)
  if (process.env.NODE_ENV !== "test") {
    console.error("Unhandled error:", {
      message: err.message,
      code: err.code,
      stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
    });
  }

  // Multer errors (file upload issues)
  if (err?.name === "MulterError") {
    return sendError(res, err.message || "Upload error", 400, {
      field: err.field,
      code: err.code,
    });
  }

  // Zod validation errors
  if (err?.name === "ZodError") {
    return sendError(res, "Validation error", 400, {
      errors: (err as any).errors,
    });
  }

  // CORS errors
  if (err?.message?.includes("CORS")) {
    return sendError(res, err.message, 403);
  }

  // JSON parsing errors
  if (err?.name === "SyntaxError" && (err as any).body) {
    return sendError(res, "Invalid JSON in request body", 400);
  }

  // Default to 500 for unknown errors
  const statusCode = err.statusCode || 500;
  const message =
    process.env.NODE_ENV === "production" && statusCode === 500
      ? "Internal server error"
      : err.message || "Internal server error";

  return sendError(res, message, statusCode);
});

// ======================================================================
//                      START SERVER
// ======================================================================

const server = app.listen(PORT, () => {
  console.log(`Heirclark backend listening on port ${PORT}`);
  console.log(`GDPR endpoints: /api/v1/gdpr/export, /api/v1/gdpr/delete, /api/v1/gdpr/retention`);

  // Schedule data retention cleanup job (runs daily at 2 AM)
  if (process.env.NODE_ENV === 'production') {
    scheduleRetentionJob('02:00');
    console.log('Data retention job scheduled for 2:00 AM daily');
  }
});

// Graceful shutdown - flush audit logs
process.on("SIGTERM", async () => {
  console.log("SIGTERM received, shutting down gracefully...");
  await auditLogger.shutdown();
  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
});

process.on("SIGINT", async () => {
  console.log("SIGINT received, shutting down gracefully...");
  await auditLogger.shutdown();
  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
});

export default app;
