import { Router } from "express";
import { z } from "zod";
import { v4 as uuid } from "uuid";
import { memoryStore } from "../services/inMemoryStore";
import { Meal, MealItem, MealType } from "../domain/types";
import { todayDateOnly } from "../utils/date";

export const mealsRouter = Router();

const mealItemSchema = z.object({
  name: z.string().min(1),
  brand: z.string().optional().nullable(),
  servingSize: z.string().optional().nullable(),
  calories: z.number().nonnegative(),
  protein: z.number().nonnegative(),
  carbs: z.number().nonnegative(),
  fat: z.number().nonnegative(),
  fiber: z.number().nonnegative().optional(),
  sugar: z.number().nonnegative().optional(),
  sodium: z.number().nonnegative().optional()
});

const createMealSchema = z.object({
  datetime: z.string().datetime().optional(), // default now
  mealType: z.enum(["breakfast", "lunch", "dinner", "snack"]),
  source: z.enum(["manual", "photo"]).default("manual"),
  items: z.array(mealItemSchema).min(1)
});

mealsRouter.post("/", (req, res, next) => {
  try {
    const parsed = createMealSchema.parse(req.body);

    const mealId = uuid();
    const datetime = parsed.datetime ?? new Date().toISOString();

    const items: MealItem[] = parsed.items.map((i) => ({
      ...i,
      id: uuid()
    }));

    const meal: Meal = {
      id: mealId,
      userId: memoryStore.userId,
      datetime,
      mealType: parsed.mealType as MealType,
      source: parsed.source,
      items
    };

    memoryStore.meals.push(meal);

    const totalCalories = items.reduce((sum, i) => sum + i.calories, 0);
    const macros = {
      protein: items.reduce((s, i) => s + i.protein, 0),
      carbs: items.reduce((s, i) => s + i.carbs, 0),
      fat: items.reduce((s, i) => s + i.fat, 0)
    };

    res.status(201).json({ meal, totalCalories, macros });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/meals?date=YYYY-MM-DD
mealsRouter.get("/", (req, res) => {
  const date = (req.query.date as string) || todayDateOnly();

  const meals = memoryStore.meals.filter((m) =>
    m.datetime.startsWith(date)
  );

  res.json({ date, meals });
});

// GET /api/v1/meals/:id
mealsRouter.get("/:id", (req, res) => {
  const meal = memoryStore.meals.find((m) => m.id === req.params.id);
  if (!meal) {
    return res.status(404).json({ error: "Meal not found" });
  }
  res.json(meal);
});

// DELETE /api/v1/meals/:id
mealsRouter.delete("/:id", (req, res) => {
  const idx = memoryStore.meals.findIndex((m) => m.id === req.params.id);
  if (idx === -1) {
    return res.status(404).json({ error: "Meal not found" });
  }
  memoryStore.meals.splice(idx, 1);
  res.status(204).send();
});
