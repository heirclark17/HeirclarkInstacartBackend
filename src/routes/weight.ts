import { Router } from "express";
import { z } from "zod";
import { v4 as uuid } from "uuid";
import { memoryStore } from "../services/inMemoryStore";

export const weightRouter = Router();

const logWeightSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // YYYY-MM-DD
  weightLbs: z.number().positive()
});

weightRouter.post("/log", (req, res, next) => {
  try {
    const parsed = logWeightSchema.parse(req.body);

    const existingIdx = memoryStore.weights.findIndex(
      (w) => w.date === parsed.date && w.userId === memoryStore.userId
    );
    if (existingIdx >= 0) {
      memoryStore.weights[existingIdx].weightLbs = parsed.weightLbs;
      return res.json(memoryStore.weights[existingIdx]);
    }

    const log = {
      id: uuid(),
      userId: memoryStore.userId,
      date: parsed.date,
      weightLbs: parsed.weightLbs
    };
    memoryStore.weights.push(log);
    res.status(201).json(log);
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/weight/current
weightRouter.get("/current", (_req, res) => {
  if (memoryStore.weights.length === 0) {
    return res.json({ currentWeightLbs: null, lastLogDate: null });
  }
  const sorted = memoryStore.weights
    .filter((w) => w.userId === memoryStore.userId)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const latest = sorted[0];

  // temporary fixed goal until goals module exists
  const goalWeightLbs = 225;
  const startWeightLbs = sorted[sorted.length - 1].weightLbs;

  const totalDelta = startWeightLbs - goalWeightLbs;
  const achievedDelta = startWeightLbs - latest.weightLbs;
  const percentToGoal =
    totalDelta <= 0 ? 0 : Math.max(0, Math.min(1, achievedDelta / totalDelta));

  res.json({
    currentWeightLbs: latest.weightLbs,
    lastLogDate: latest.date,
    goalWeightLbs,
    startWeightLbs,
    percentToGoal
  });
});

// GET /api/v1/weight/progress?rangeDays=90
weightRouter.get("/progress", (req, res) => {
  const rangeDays = parseInt((req.query.rangeDays as string) || "90", 10);

  const weights = memoryStore.weights
    .filter((w) => w.userId === memoryStore.userId)
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  // No fancy date filtering yet – you can refine later
  const goalWeightLbs = 225;

  res.json({
    rangeDays,
    points: weights,
    goalWeightLbs
  });
});
