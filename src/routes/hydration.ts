import { Router, Request, Response } from "express";
import { z } from "zod";
import { v4 as uuid } from "uuid";
import { memoryStore } from "../services/inMemoryStore";
import { WaterLog } from "../domain/types";
import { todayDateOnly } from "../utils/date";
import { asyncHandler } from "../middleware/asyncHandler";
import { getUserPreferences } from "../services/userPreferences";
import { sendSuccess, sendValidationError } from "../middleware/responseHelper";
import { authMiddleware } from "../middleware/auth";

export const hydrationRouter = Router();

// ✅ SECURITY FIX: Apply STRICT authentication (OWASP A01: IDOR Protection)
hydrationRouter.use(authMiddleware());

const logWaterSchema = z.object({
  datetime: z.string().datetime().optional(),
  amountMl: z.number().positive()
});

/**
 * Helper to get customer ID from request.
 */
function getCustomerId(req: Request): string {
  const header = req.headers["x-shopify-customer-id"] as string | undefined;
  const query = req.query?.shopifyCustomerId as string | undefined;
  const body = (req.body as any)?.shopifyCustomerId as string | undefined;
  return String(header || query || body || memoryStore.userId || "").trim();
}

hydrationRouter.post("/log", (req, res, next) => {
  try {
    const parsed = logWaterSchema.parse(req.body);
    const userId = getCustomerId(req);

    const log: WaterLog = {
      id: uuid(),
      userId,
      datetime: parsed.datetime ?? new Date().toISOString(),
      amountMl: parsed.amountMl
    };

    memoryStore.waterLogs.push(log);

    sendSuccess(res, log, 201);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return sendValidationError(res, err.errors.map(e => e.message));
    }
    next(err);
  }
});

// GET /api/v1/hydration/day-summary?date=YYYY-MM-DD
hydrationRouter.get("/day-summary", asyncHandler(async (req: Request, res: Response) => {
  const userId = getCustomerId(req);
  const date = (req.query.date as string) || todayDateOnly();

  const totalMl = memoryStore.waterLogs
    .filter((w) => w.userId === userId && w.datetime.startsWith(date))
    .reduce((sum, w) => sum + w.amountMl, 0);

  // Get configurable hydration target from user preferences
  const prefs = await getUserPreferences(userId);
  const targetMl = prefs.hydrationTargetMl || Number(process.env.DEFAULT_HYDRATION_TARGET_ML) || 3000;

  sendSuccess(res, { date, totalMl, targetMl });
}));
