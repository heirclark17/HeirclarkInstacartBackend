import { Router } from "express";
import { todayDateOnly } from "../utils/date";
import {
  computeDailyTotals,
  computeRemaining,
  getMealsForDate,
  getStaticDailyTargets
} from "../services/nutritionService";
import { computeStreak } from "../services/streakService";

export const nutritionRouter = Router();

// GET /api/v1/nutrition/day-summary?date=YYYY-MM-DD
nutritionRouter.get("/day-summary", (req, res) => {
  const date = (req.query.date as string) || todayDateOnly();

  const targets = getStaticDailyTargets();
  const consumed = computeDailyTotals(date);
  const remaining = computeRemaining(targets, consumed);
  const meals = getMealsForDate(date);
  const streak = computeStreak();

  // Placeholder health score until AI is added
  const healthScore =
    consumed.calories === 0 ? null : Math.min(100, Math.max(40, 100 - remaining.sugar / 2));

  res.json({
    date,
    targets,
    consumed,
    remaining,
    healthScore,
    streak,
    recentMeals: meals
      .slice()
      .sort((a, b) => (a.datetime < b.datetime ? 1 : -1))
      .slice(0, 5)
  });
});
