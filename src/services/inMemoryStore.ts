import { Meal, WaterLog, WeightLog } from "../domain/types";

const SINGLE_USER_ID = "demo-user"; // until auth is wired

export const memoryStore = {
  userId: SINGLE_USER_ID,
  meals: [] as Meal[],
  weights: [] as WeightLog[],
  waterLogs: [] as WaterLog[]
};
