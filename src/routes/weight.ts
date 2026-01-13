import { Router, Response } from "express";
import { z } from "zod";
import { v4 as uuid } from "uuid";
import { memoryStore } from "../services/inMemoryStore";
import { asyncHandler } from "../middleware/asyncHandler";
import { getUserPreferences } from "../services/userPreferences";
import { sendSuccess, sendError, sendValidationError } from "../middleware/responseHelper";
import { authMiddleware, getCustomerId, AuthenticatedRequest } from "../middleware/auth";

export const weightRouter = Router();

// ✅ SECURITY FIX: Apply STRICT authentication to all weight routes (OWASP A01: IDOR Protection)
// strictAuth: true blocks legacy X-Shopify-Customer-Id headers to prevent IDOR attacks
weightRouter.use(authMiddleware());

const logWeightSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // YYYY-MM-DD
  weightLbs: z.number().positive()
});

weightRouter.post("/log", (req: AuthenticatedRequest, res, next) => {
  try {
    const parsed = logWeightSchema.parse(req.body);
    // ✅ Use validated customer ID from authMiddleware
    const userId = getCustomerId(req);

    if (!userId) {
      return res.status(401).json({ ok: false, error: "Authentication required" });
    }

    const existingIdx = memoryStore.weights.findIndex(
      (w) => w.date === parsed.date && w.userId === userId
    );
    if (existingIdx >= 0) {
      memoryStore.weights[existingIdx].weightLbs = parsed.weightLbs;
      return sendSuccess(res, memoryStore.weights[existingIdx]);
    }

    const log = {
      id: uuid(),
      userId,
      date: parsed.date,
      weightLbs: parsed.weightLbs
    };
    memoryStore.weights.push(log);
    sendSuccess(res, log, 201);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return sendValidationError(res, err.errors.map(e => e.message));
    }
    next(err);
  }
});

// GET /api/v1/weight/current
weightRouter.get("/current", asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  // ✅ Use validated customer ID from authMiddleware
  const userId = getCustomerId(req);

  if (!userId) {
    return res.status(401).json({ ok: false, error: "Authentication required" });
  }

  if (memoryStore.weights.length === 0) {
    return sendSuccess(res, { currentWeightLbs: null, lastLogDate: null });
  }

  const sorted = memoryStore.weights
    .filter((w) => w.userId === userId)
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  if (sorted.length === 0) {
    return sendSuccess(res, { currentWeightLbs: null, lastLogDate: null });
  }

  const latest = sorted[0];

  // Get configurable goal weight from user preferences
  const prefs = await getUserPreferences(userId);
  const goalWeightLbs = prefs.goalWeightLbs || Number(process.env.DEFAULT_GOAL_WEIGHT_LBS) || 225;
  const startWeightLbs = sorted[sorted.length - 1].weightLbs;

  const totalDelta = startWeightLbs - goalWeightLbs;
  const achievedDelta = startWeightLbs - latest.weightLbs;
  const percentToGoal =
    totalDelta <= 0 ? 0 : Math.max(0, Math.min(1, achievedDelta / totalDelta));

  sendSuccess(res, {
    currentWeightLbs: latest.weightLbs,
    lastLogDate: latest.date,
    goalWeightLbs,
    startWeightLbs,
    percentToGoal
  });
}));

// GET /api/v1/weight/progress?rangeDays=90
weightRouter.get("/progress", asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = getCustomerId(req);

  if (!userId) {
    return res.status(401).json({ ok: false, error: "Authentication required" });
  }

  const rangeDays = parseInt((req.query.rangeDays as string) || "90", 10);

  const weights = memoryStore.weights
    .filter((w) => w.userId === userId)
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  // Get configurable goal weight from user preferences
  const prefs = await getUserPreferences(userId);
  const goalWeightLbs = prefs.goalWeightLbs || Number(process.env.DEFAULT_GOAL_WEIGHT_LBS) || 225;

  sendSuccess(res, {
    rangeDays,
    points: weights,
    goalWeightLbs
  });
}));
