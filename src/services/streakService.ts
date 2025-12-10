import { memoryStore } from "./inMemoryStore";
import { toDateOnly } from "../utils/date";

export function computeStreak(): {
  currentStreakDays: number;
  lastLoggedDate: string | null;
} {
  const dates = new Set<string>();

  for (const m of memoryStore.meals) {
    dates.add(toDateOnly(m.datetime));
  }
  for (const w of memoryStore.weights) {
    dates.add(w.date);
  }

  if (dates.size === 0) {
    return { currentStreakDays: 0, lastLoggedDate: null };
  }

  const ordered = Array.from(dates).sort();
  const last = ordered[ordered.length - 1];

  // count backwards from most recent until a gap
  let streak = 1;
  let current = new Date(last);

  while (true) {
    const prev = new Date(current);
    prev.setDate(prev.getDate() - 1);
    const prevStr = prev.toISOString().slice(0, 10);
    if (dates.has(prevStr)) {
      streak += 1;
      current = prev;
    } else {
      break;
    }
  }

  return { currentStreakDays: streak, lastLoggedDate: last };
}
