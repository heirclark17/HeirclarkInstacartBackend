// src/index.ts

import express, { Request, Response, NextFunction } from "express";
import crypto from "crypto";

// If you already have these types/services defined, keep these imports.
// They’re used as a fallback for other endpoints.
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
const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS || 60000); // 60s default

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ======================================================================
//                         AI MEAL PLAN HELPERS
// ======================================================================

// Build a safe, minimal WeekPlan skeleton (used when AI fails)
function buildFallbackWeekPlan(constraints: UserConstraints): WeekPlan {
  try {
    // Use your existing generator if it’s implemented
    return generateWeekPlan(constraints);
  } catch {
    const days = Array.from({ length: 7 }).map((_, i) => ({
      dayIndex: i,
      label: `Day ${i + 1}`,
      note:
        "Fallback meal framework — detailed AI recipes were unavailable. Use this as a structure for your own meals.",
      meals: [
        {
          type: "breakfast",
          title: "High-protein breakfast",
          calories: Math.round((constraints.dailyCalories || 0) * 0.25),
          protein: Math.round((constraints.proteinGrams || 0) * 0.3),
          carbs: Math.round((constraints.carbsGrams || 0) * 0.25),
          fats: Math.round((constraints.fatsGrams || 0) * 0.25),
        },
        {
          type: "lunch",
          title: "Balanced lunch",
          calories: Math.round((constraints.dailyCalories || 0) * 0.35),
          protein: Math.round((constraints.proteinGrams || 0) * 0.35),
          carbs: Math.round((constraints.carbsGrams || 0) * 0.35),
          fats: Math.round((constraints.fatsGrams || 0) * 0.35),
        },
        {
          type: "dinner",
          title: "Evening plate",
          calories: Math.round((constraints.dailyCalories || 0) * 0.4),
          protein: Math.round((constraints.proteinGrams || 0) * 0.35),
          carbs: Math.round((constraints.carbsGrams || 0) * 0.4),
          fats: Math.round((constraints.fatsGrams || 0) * 0.4),
        },
      ],
    }));

    return {
      mode: "fallback",
      generatedAt: new Date().toISOString(),
      constraints,
      days,
      recipes: [],
    } as unknown as WeekPlan;
  }
}

// Small helper to enforce timeout on OpenAI calls
function fetchWithTimeout(
  url: string,
  options: any,
  timeoutMs: number
): Promise<globalThis.Response> {
  const controller = new AbortController(); // safe constructor in Node 18+
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  return fetch(url, { ...options, signal: controller.signal }).finally(() => {
    clearTimeout(timer);
  });
}

// Call OpenAI to build a WeekPlan that includes days[] (+ optional recipes[])
// IMPORTANT: This function now ALWAYS returns a WeekPlan.
// On any error / timeout / bad JSON → it returns buildFallbackWeekPlan(constraints).
async function callOpenAiMealPlan(
  constraints: UserConstraints,
  pantry?: string[]
): Promise<WeekPlan> {
  // If no key, just return fallback
  if (!OPENAI_API_KEY) {
    console.warn("OPENAI_API_KEY is not set – using fallback week plan.");
    return buildFallbackWeekPlan(constraints);
  }

  const payload = {
    model: OPENAI_MODEL,
    temperature: 0.6,
    response_format: { type: "json_object" as const },
    messages: [
      {
        role: "system",
        content:
          "You are a nutrition coach creating practical 7-day meal plans " +
          "for a health + grocery shopping app. " +
          "You MUST return ONLY valid JSON (no markdown). " +
          "Keep text concise and avoid long descriptions so the JSON stays small.",
      },
      {
        role: "user",
        content: JSON.stringify({
          instructions:
            "Create a 7-day meal plan that fits these macros, budget, allergies, and cooking skill. " +
            "Breakfast, lunch, and dinner each day. Use realistic, simple recipes that are easy to cook.",
          constraints,
          pantry: pantry || [],
          schema: {
            mode: "ai",
            generatedAt: "ISO 8601 timestamp string",
            constraints:
              "Echo of the inputs you received (dailyCalories, macros, budget, etc.)",

            // Minimal shape so the model doesn't go crazy with size
            days: [
              {
                day: "1–7 (1-based index)",
                label: "e.g., 'Day 1'",
                meals: [
                  {
                    type: "breakfast | lunch | dinner",
                    recipeId: "matches recipes[].id",
                    title: "Short recipe name",
                    calories: "number",
                    protein: "number",
                    carbs: "number",
                    fats: "number",
                    portionLabel: "e.g. '6 oz', '1 plate'",
                    notes: "short, practical instructions",
                  },
                ],
              },
            ],

            recipes: [
              {
                id: "unique id; referenced by meals[].recipeId",
                name: "Recipe title",
                ingredients: [
                  {
                    name: "ingredient name",
                    quantity: "number per serving",
                    unit: "e.g. 'oz','cup','tbsp','each'",
                    instacart_query:
                      "optional; search string to use for Instacart",
                  },
                ],
              },
            ],
          },
        }),
      },
    ],
  };

  console.log("Calling OpenAI /chat/completions with model:", OPENAI_MODEL, {
    timeoutMs: OPENAI_TIMEOUT_MS,
    hasPantry: !!(pantry && pantry.length),
  });

  const started = Date.now();
  let resp: globalThis.Response;

  // ---- Network / timeout protection ----
  try {
    resp = await fetchWithTimeout(
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
  } catch (err: any) {
    const isAbort =
      err?.name === "AbortError" ||
      String(err?.message || "").toLowerCase().includes("aborted");

    console.error(
      "OpenAI /chat/completions fetch failed (network/timeout):",
      err
    );

    if (isAbort) {
      console.warn(
        `OpenAI call aborted after ~${Math.round(
          OPENAI_TIMEOUT_MS / 1000
        )}s – returning fallback plan.`
      );
    }

    return buildFallbackWeekPlan(constraints);
  }

  const duration = Date.now() - started;
  console.log(
    `OpenAI /chat/completions finished in ${duration} ms with status ${resp.status}`
  );

  // ---- HTTP error from OpenAI → fallback ----
  if (!resp.ok) {
    const txt = await resp.text();
    console.error("OpenAI /chat/completions error:", resp.status, txt);
    return buildFallbackWeekPlan(constraints);
  }

  // ---- Parse JSON body safely ----
  let json: any;
  try {
    json = await resp.json();
  } catch (err) {
    console.error("Failed to decode OpenAI JSON body:", err);
    return buildFallbackWeekPlan(constraints);
  }

  const content = json?.choices?.[0]?.message?.content;

  if (!content || typeof content !== "string") {
    console.error("OpenAI response missing content field:", json);
    return buildFallbackWeekPlan(constraints);
  }

  let plan: WeekPlan;
  try {
    console.log("RAW_OPENAI_CONTENT_START");
    console.log(content);
    console.log("RAW_OPENAI_CONTENT_END");

    plan = JSON.parse(content);
  } catch (err) {
    console.error(
      "Failed to parse OpenAI JSON. Raw (first 800 chars):",
      content.slice(0, 800)
    );
    return buildFallbackWeekPlan(constraints);
  }

  const anyPlan = plan as any;
  if (!anyPlan || !Array.isArray(anyPlan.days)) {
    console.error("OpenAI JSON did not include days[] as expected:", plan);
    return buildFallbackWeekPlan(constraints);
  }

  if (!Array.isArray(anyPlan.recipes)) {
    console.warn(
      "OpenAI JSON missing recipes[]; adding empty recipes array to keep frontend safe."
    );
    anyPlan.recipes = [];
  }

  // Explicitly mark that this came from AI
  anyPlan.mode = "ai";
  anyPlan.generatedAt = anyPlan.generatedAt || new Date().toISOString();

  return plan;
}

// Shared handler so we can mount it on both /api/meal-plan and /proxy/meal-plan
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

    // This will either be an AI plan or a local fallback, but never throws.
    const weekPlan = await callOpenAiMealPlan(constraints);

    return res.status(200).json({ ok: true, weekPlan });
  } catch (err: any) {
    console.error("Error in AI meal plan handler:", err);
    return res.status(500).json({
      ok: false,
      error: err?.message || "Failed to generate AI meal plan",
    });
  }
}

// ======================================================================
//                      AI MEAL PLAN API ENDPOINTS
// ======================================================================

app.post("/api/meal-plan", handleAiMealPlan);
app.post("/proxy/meal-plan", verifyAppProxy, handleAiMealPlan);

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

    // Same idea: try AI, fall back to your pantry-based generator on failure.
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

      // Optional: recipe endpoint (safe to keep as you had it)
      let recipeProductsLinkUrl: string | null = null;
      let recipeError: string | null = null;

      try {
        const recipeIngredients = instacartLineItems.map((li) => ({
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
                JSON.stringify(recipeData).slice(0, 200);
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
