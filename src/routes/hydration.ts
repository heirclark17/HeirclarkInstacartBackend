import { Router } from "express";
import { z } from "zod";
import { v4 as uuid } from "uuid";
import { memoryStore } from "../services/inMemoryStore";
import { WaterLog } from "../domain/types";
import { todayDateOnly } from "../utils/date";

export const hydrationRouter = Router();

const logWaterSchema = z.object({
  datetime: z.string().datetime().optional(),
  amountMl: z.number().positive()
});

hydrationRouter.post("/log", (req, res, next) => {
  try {
    const parsed = logWaterSchema.parse(req.body);

    const log: WaterLog = {
      id: uuid(),
      userId: memoryStore.userId,
      datetime: parsed.datetime ?? new Date().toISOString(),
      amountMl: parsed.amountMl
    };

    memoryStore.waterLogs.push(log);

    res.status(201).json(log);
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/hydration/day-summary?date=YYYY-MM-DD
hydrationRouter.get("/day-summary", (req, res) => {
  const date = (req.query.date as string) || todayDateOnly();

  const totalMl = memoryStore.waterLogs
    .filter((w) => w.datetime.startsWith(date))
    .reduce((sum, w) => sum + w.amountMl, 0);

  // simple 3L default target
  const targetMl = 3000;

  res.json({ date, totalMl, targetMl });
});
