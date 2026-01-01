// src/routes/preferences.ts
import { Router, Request, Response } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/asyncHandler";
import { authMiddleware, AuthenticatedRequest } from "../middleware/auth";
import {
  sendSuccess,
  sendError,
  sendValidationError,
} from "../middleware/responseHelper";
import {
  getUserPreferences,
  updateUserPreferences,
} from "../services/userPreferences";

export const preferencesRouter = Router();

// Apply auth middleware to all routes
preferencesRouter.use(authMiddleware({ required: true }));

/**
 * Card background schema
 */
const solidBackgroundSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.literal("solid"),
  hex: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
});

const gradientBackgroundSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.literal("gradient"),
  colors: z.array(z.string().regex(/^#[0-9A-Fa-f]{6}$/)).min(2).max(3),
});

const cardBackgroundSchema = z.union([solidBackgroundSchema, gradientBackgroundSchema]);

/**
 * Update preferences schema
 */
const updatePreferencesSchema = z.object({
  goalWeightLbs: z.number().positive().optional(),
  hydrationTargetMl: z.number().positive().max(10000).optional(),
  caloriesTarget: z.number().positive().max(10000).optional(),
  proteinTarget: z.number().positive().max(1000).optional(),
  carbsTarget: z.number().positive().max(1000).optional(),
  fatTarget: z.number().positive().max(500).optional(),
  timezone: z.string().max(50).optional(),
  cardBackground: cardBackgroundSchema.optional(),
});

/**
 * GET /api/v1/preferences
 *
 * Get user preferences (goals, targets, settings).
 */
preferencesRouter.get(
  "/",
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const customerId = req.auth?.customerId;
    if (!customerId) {
      return sendError(res, "Missing customer ID", 400);
    }

    const prefs = await getUserPreferences(customerId);
    return sendSuccess(res, prefs);
  })
);

/**
 * PUT /api/v1/preferences
 *
 * Update user preferences.
 */
preferencesRouter.put(
  "/",
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const customerId = req.auth?.customerId;
    if (!customerId) {
      return sendError(res, "Missing customer ID", 400);
    }

    // Validate request body
    const parseResult = updatePreferencesSchema.safeParse(req.body);
    if (!parseResult.success) {
      return sendValidationError(
        res,
        parseResult.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`)
      );
    }

    const updated = await updateUserPreferences(customerId, parseResult.data);
    return sendSuccess(res, updated);
  })
);

/**
 * PATCH /api/v1/preferences
 *
 * Partially update user preferences (alias for PUT).
 */
preferencesRouter.patch(
  "/",
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const customerId = req.auth?.customerId;
    if (!customerId) {
      return sendError(res, "Missing customer ID", 400);
    }

    const parseResult = updatePreferencesSchema.safeParse(req.body);
    if (!parseResult.success) {
      return sendValidationError(
        res,
        parseResult.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`)
      );
    }

    const updated = await updateUserPreferences(customerId, parseResult.data);
    return sendSuccess(res, updated);
  })
);

/**
 * GET /api/v1/preferences/goals
 *
 * Get just the nutrition goals.
 */
preferencesRouter.get(
  "/goals",
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const customerId = req.auth?.customerId;
    if (!customerId) {
      return sendError(res, "Missing customer ID", 400);
    }

    const prefs = await getUserPreferences(customerId);
    return sendSuccess(res, {
      calories: prefs.caloriesTarget,
      protein: prefs.proteinTarget,
      carbs: prefs.carbsTarget,
      fat: prefs.fatTarget,
      goalWeightLbs: prefs.goalWeightLbs,
      hydrationTargetMl: prefs.hydrationTargetMl,
    });
  })
);

/**
 * PUT /api/v1/preferences/goals
 *
 * Update nutrition goals.
 */
preferencesRouter.put(
  "/goals",
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const customerId = req.auth?.customerId;
    if (!customerId) {
      return sendError(res, "Missing customer ID", 400);
    }

    const goalsSchema = z.object({
      calories: z.number().positive().max(10000).optional(),
      protein: z.number().positive().max(1000).optional(),
      carbs: z.number().positive().max(1000).optional(),
      fat: z.number().positive().max(500).optional(),
      goalWeightLbs: z.number().positive().optional(),
      hydrationTargetMl: z.number().positive().max(10000).optional(),
    });

    const parseResult = goalsSchema.safeParse(req.body);
    if (!parseResult.success) {
      return sendValidationError(
        res,
        parseResult.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`)
      );
    }

    const updates: any = {};
    if (parseResult.data.calories !== undefined) {
      updates.caloriesTarget = parseResult.data.calories;
    }
    if (parseResult.data.protein !== undefined) {
      updates.proteinTarget = parseResult.data.protein;
    }
    if (parseResult.data.carbs !== undefined) {
      updates.carbsTarget = parseResult.data.carbs;
    }
    if (parseResult.data.fat !== undefined) {
      updates.fatTarget = parseResult.data.fat;
    }
    if (parseResult.data.goalWeightLbs !== undefined) {
      updates.goalWeightLbs = parseResult.data.goalWeightLbs;
    }
    if (parseResult.data.hydrationTargetMl !== undefined) {
      updates.hydrationTargetMl = parseResult.data.hydrationTargetMl;
    }

    const prefs = await updateUserPreferences(customerId, updates);
    return sendSuccess(res, {
      calories: prefs.caloriesTarget,
      protein: prefs.proteinTarget,
      carbs: prefs.carbsTarget,
      fat: prefs.fatTarget,
      goalWeightLbs: prefs.goalWeightLbs,
      hydrationTargetMl: prefs.hydrationTargetMl,
    });
  })
);

export default preferencesRouter;
