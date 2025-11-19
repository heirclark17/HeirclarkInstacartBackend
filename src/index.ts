// src/index.ts

import express, { Request, Response, NextFunction } from "express";
import crypto from "crypto";

// ---- AI Meal Plan imports ----
import { UserConstraints, WeekPlan } from "./types/mealPlan";
import {
  generateWeekPlan,
  adjustWeekPlan,
  generateFromPantry,
} from "./services/mealPlanner";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ======================================================================
//                          HEALTH / ROOT
// ======================================================================

app.get("/", (_req: Request, res: Response) => {
  res.status(200).json({ ok: true, service: "heirclark-backend" });
});

// ======================================================================
//                      HMAC VERIFICATION (APP PROXY)
// ======================================================================

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

// ======================================================================
//                            TYPES (INSTACART)
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

// ======================================================================
//                      AI MEAL PLAN CORE HANDLERS
// ======================================================================
// We implement handlers once, then mount them under:
//   - /api/meal-plan*   (direct backend calls)
//   - /proxy/meal-plan* (Shopify App Proxy via /apps/instacart/...)
//
// On Shopify side, calls should be:
//   POST /apps/instacart/meal-plan
//   POST /apps/instacart/meal-plan/adjust
//   POST /apps/instacart/meal-plan/from-pantry
// ======================================================================

function handleGenerateMealPlan(req: Request, res: Response) {
  try {
    const constraints = req.body as UserConstraints;

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

    const weekPlan: WeekPlan = generateWeekPlan(constraints);
    return res.status(200).json({ ok: true, weekPlan });
  } catch (err: any) {
    console.error("Error in generateMealPlan:", err);
    return res.status(500).json({
      ok: false,
      error: err?.message || "Failed to generate meal plan",
    });
  }
}

function handleAdjustMealPlan(req: Request, res: Response) {
  try {
    const { weekPlan, actualIntake } = req.body as {
      weekPlan: WeekPlan;
      actualIntake: Record<string, { caloriesDelta: number }>;
    };

    if (!weekPlan || !Array.isArray(weekPlan.days)) {
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
    console.error("Error in adjustMealPlan:", err);
    return res.status(500).json({
      ok: false,
      error: err?.message || "Failed to adjust meal plan",
    });
  }
}

function handleMealPlanFromPantry(req: Request, res: Response) {
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

    const weekPlan: WeekPlan = generateFromPantry(constraints, pantry);
    return res.status(200).json({ ok: true, weekPlan });
  } catch (err: any) {
    console.error("Error in mealPlanFromPantry:", err);
    return res.status(500).json({
      ok: false,
      error: err?.message || "Failed to generate from pantry",
    });
  }
}

// ---------- Direct API (not via Shopify proxy) ----------
app.post("/api/meal-plan", handleGenerateMealPlan);
app.post("/api/meal-plan/adjust", handleAdjustMealPlan);
app.post("/api/meal-plan/from-pantry", handleMealPlanFromPantry);

// ---------- Shopify App Proxy versions ----------
// Shopify: /apps/instacart/meal-plan → backend: /proxy/meal-plan
app.post("/proxy/meal-plan", verifyAppProxy, handleGenerateMealPlan);
app.post("/proxy/meal-plan/adjust", verifyAppProxy, handleAdjustMealPlan);
app.post(
  "/proxy/meal-plan/from-pantry",
  verifyAppProxy,
  handleMealPlanFromPantry
);

// ======================================================================
//                  INSTACART / APP PROXY ROUTES (EXISTING)
// ======================================================================

// Simple debug GET for proxy root: /apps/instacart?ping=1
app.get("/proxy/build-list", (req: Request, res: Response) => {
  res.status(200).json({
    ok: true,
    via: "app-proxy",
    ping: req.query.ping ?? null,
  });
});

// ---------- GET /proxy/retailers (store picker support) ----------
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

// ---------- POST /proxy/build-list (App Proxy) ----------
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

      // 1) Shopping list / products_link
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
            "Forbidden – your Instacart API key or account is not authorized to use the shopping list endpoint. Please confirm that Product Links / Shopping List Pages are enabled for this key.";
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

      // 2) Optional recipe link
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

        if (
          typeof meta.cooking_time === "number" &&
          meta.cooking_time > 0
        ) {
          recipePayload.cooking_time = meta.cooking_time;
        }

        if (
          typeof meta.author === "string" &&
          meta.author.trim().length > 0
        ) {
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
//                        START SERVER
// ======================================================================

app.listen(PORT, () => {
  console.log(`Heirclark backend listening on port ${PORT}`);
});
