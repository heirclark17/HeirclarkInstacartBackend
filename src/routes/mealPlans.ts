// src/routes/mealPlan.ts
import { Router, Request, Response } from "express";
import { WeekPlan, UserConstraints } from "../types/mealPlan";
import { generateWeekPlan, adjustWeekPlan, generateFromPantry } from "../services/mealPlanner";

const router = Router();

// POST /api/meal-plan
router.post("/", (req: Request, res: Response) => {
  const constraints = req.body as UserConstraints;

  try {
    const weekPlan: WeekPlan = generateWeekPlan(constraints);
    return res.status(200).json({ ok: true, weekPlan });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ ok: false, error: err.message ?? "Failed to generate plan" });
  }
});

// POST /api/meal-plan/adjust
// body: { weekPlan, actualIntake: { [date]: { caloriesOverUnder: number } } }
router.post("/adjust", (req: Request, res: Response) => {
  const { weekPlan, actualIntake } = req.body as {
    weekPlan: WeekPlan;
    actualIntake: Record<string, { caloriesDelta: number }>;
  };

  try {
    const adjusted = adjustWeekPlan(weekPlan, actualIntake);
    return res.status(200).json({ ok: true, weekPlan: adjusted });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ ok: false, error: err.message ?? "Failed to adjust plan" });
  }
});

// POST /api/meal-plan/from-pantry
// body: { constraints, pantry: string[] }
router.post("/from-pantry", (req: Request, res: Response) => {
  const { constraints, pantry } = req.body as {
    constraints: UserConstraints;
    pantry: string[];
  };

  try {
    const weekPlan: WeekPlan = generateFromPantry(constraints, pantry);
    return res.status(200).json({ ok: true, weekPlan });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ ok: false, error: err.message ?? "Failed to generate from pantry" });
  }
});

export default router;
