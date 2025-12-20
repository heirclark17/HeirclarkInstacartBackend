import { Router, Request, Response } from "express";
import multer from "multer";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 }, // 12MB
});

type NormalizedMealAI = {
  mealName: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  foods: string[];
  swaps: string[];
  confidence: number; // 0..100
  portionNotes: string;
  explanation: string;
};

function clamp(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function num(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function toStringArray(input: any): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((x) => {
      if (typeof x === "string") return x.trim();
      if (x && typeof x === "object") {
        const s = x.name ?? x.food ?? x.item ?? x.title ?? x.label;
        return s ? String(s).trim() : "";
      }
      return "";
    })
    .filter(Boolean);
}

/**
 * Normalize ANY AI output shape into the ONE shape the frontend expects.
 * Supports:
 *  - top-level fields
 *  - nested "normalized"
 *  - alternate keys like fats/fat, name/title/mealName, etc.
 */
export function normalizeMealAI(raw: any): NormalizedMealAI {
  const d = raw?.normalized ?? raw ?? {};

  const mealName =
    String(d.mealName ?? d.name ?? d.title ?? d.label ?? "Meal").trim() || "Meal";

  const calories = num(d.calories ?? d.kcal ?? d.energy);
  const protein = num(d.protein ?? d.proteins);
  const carbs = num(d.carbs ?? d.carbohydrates);
  const fat = num(d.fat ?? d.fats ?? d.lipids);

  const foods = toStringArray(d.foods ?? d.items ?? d.ingredients);
  const swaps = toStringArray(d.swaps ?? d.healthierSwaps ?? d.recommendations);

  // confidence could be 0..1 or 0..100 or missing
  let conf = Number(d.confidence ?? d.confidencePct ?? d.score ?? 0);
  if (Number.isFinite(conf) && conf > 0 && conf <= 1) conf = conf * 100;
  const confidence = clamp(conf, 0, 100);

  const portionNotes = String(d.portionNotes ?? d.portion ?? d.notes ?? "").trim();
  const explanation = String(d.explanation ?? d.reasoning ?? d.summary ?? "").trim();

  return {
    mealName,
    calories,
    protein,
    carbs,
    fat,
    foods,
    swaps,
    confidence,
    portionNotes,
    explanation,
  };
}

/**
 * Replace these with your real AI functions/services.
 * IMPORTANT: Return ANY raw shape — normalizeMealAI() will standardize it.
 */
async function analyzeMealFromText(args: { shopifyCustomerId: string; text: string }) {
  // TODO: wire to your OpenAI call or existing service
  // Return your raw output here.
  return {
    mealName: "AI Meal",
    calories: 500,
    protein: 35,
    carbs: 45,
    fat: 18,
    foods: ["Chicken bowl", "Rice", "Beans"],
    swaps: ["Swap white rice → cauliflower rice", "Grill instead of fry"],
    confidence: 78,
    portionNotes: "Portion estimated from description.",
    explanation: "Estimated based on common serving sizes.",
  };
}

async function analyzeMealFromPhoto(args: {
  shopifyCustomerId: string;
  fileBuffer: Buffer;
  fileMime: string;
  fileName: string;
}) {
  // TODO: wire to your OpenAI vision call or existing service
  // Return your raw output here.
  return {
    normalized: {
      mealName: "AI Photo Meal",
      calories: 620,
      protein: 42,
      carbs: 55,
      fat: 22,
      foods: [{ name: "Salmon" }, { name: "Quinoa" }, { name: "Broccoli" }],
      swaps: ["Swap butter sauce → lemon + herbs", "Add extra veggies"],
      confidence: 0.83, // supports 0..1 too
      portionNotes: "Estimated by plate size and food type.",
      explanation: "Photo suggests salmon + grain + veg plate.",
    },
  };
}

function getShopifyCustomerId(req: Request): string {
  const q = (req.query.shopifyCustomerId as string) || "";
  const b = (req.body && (req.body.shopifyCustomerId as string)) || "";
  const cid = String(b || q || "").trim();
  return cid;
}

export const nutritionRouter = Router();

/**
 * POST /api/v1/nutrition/ai/meal-from-text
 */
nutritionRouter.post("/ai/meal-from-text", async (req: Request, res: Response) => {
  try {
    const cid = getShopifyCustomerId(req);
    const text = String(req.body?.text ?? "").trim();

    if (!cid) return res.status(400).json({ ok: false, error: "Missing shopifyCustomerId" });
    if (!text) return res.status(400).json({ ok: false, error: "Missing text" });

    const raw = await analyzeMealFromText({ shopifyCustomerId: cid, text });
    const normalized = normalizeMealAI(raw);

    return res.json({ ok: true, normalized });
  } catch (e: any) {
    console.error("[nutrition/ai/meal-from-text]", e);
    return res.status(500).json({ ok: false, error: "AI text analysis failed" });
  }
});

/**
 * POST /api/v1/nutrition/ai/meal-from-photo
 * Accepts multipart/form-data:
 *   - shopifyCustomerId
 *   - image OR photo (either works)
 */
nutritionRouter.post(
  "/ai/meal-from-photo",
  upload.fields([
    { name: "image", maxCount: 1 },
    { name: "photo", maxCount: 1 },
  ]),
  async (req: Request, res: Response) => {
    try {
      const cid = getShopifyCustomerId(req);
      if (!cid) return res.status(400).json({ ok: false, error: "Missing shopifyCustomerId" });

      const files = req.files as Record<string, Express.Multer.File[]> | undefined;
      const file =
        (files?.image && files.image[0]) ||
        (files?.photo && files.photo[0]) ||
        undefined;

      if (!file) return res.status(400).json({ ok: false, error: "Missing photo file" });

      const raw = await analyzeMealFromPhoto({
        shopifyCustomerId: cid,
        fileBuffer: file.buffer,
        fileMime: file.mimetype || "application/octet-stream",
        fileName: file.originalname || "meal.jpg",
      });

      const normalized = normalizeMealAI(raw);

      return res.json({ ok: true, normalized });
    } catch (e: any) {
      console.error("[nutrition/ai/meal-from-photo]", e);
      return res.status(500).json({ ok: false, error: "AI photo analysis failed" });
    }
  }
);
