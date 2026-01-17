export interface NormalizedActivityData {
  customer_id: string;
  source_type: 'fitbit' | 'google-fit' | 'apple-health';
  recorded_date: string;
  steps: number | null;
  active_calories: number | null;
  resting_calories: number | null;
  distance_meters: number | null;
  floors_climbed: number | null;
  active_minutes: number | null;
}

export interface NormalizedSleepData {
  customer_id: string;
  source_type: 'fitbit' | 'google-fit' | 'apple-health';
  sleep_date: string;
  total_minutes: number | null;
  deep_minutes: number | null;
  light_minutes: number | null;
  rem_minutes: number | null;
  awake_minutes: number | null;
  efficiency: number | null;
}

export interface NormalizedHeartRateData {
  customer_id: string;
  source_type: 'fitbit' | 'google-fit' | 'apple-health';
  recorded_date: string;
  resting_heart_rate: number | null;
  avg_heart_rate: number | null;
  max_heart_rate: number | null;
  min_heart_rate: number | null;
}

/**
 * Normalize Fitbit activity summary data
 */
export function normalizeFitbitActivity(rawData: any, customerId: string): NormalizedActivityData {
  // Fitbit activity summary format:
  // {
  //   date: "2026-01-16",
  //   summary: {
  //     steps: 8500,
  //     caloriesOut: 2200,
  //     caloriesBMR: 1600,
  //     distances: [{distance: 5.2, unit: "miles"}],
  //     floors: 10,
  //     fairlyActiveMinutes: 30,
  //     veryActiveMinutes: 15
  //   }
  // }

  const summary = rawData.summary || {};

  return {
    customer_id: customerId,
    source_type: 'fitbit',
    recorded_date: rawData.date || new Date().toISOString().split('T')[0],
    steps: summary.steps || null,
    active_calories: summary.caloriesOut || null,
    resting_calories: summary.caloriesBMR || null,
    distance_meters: summary.distances?.[0]?.distance
      ? Math.round(summary.distances[0].distance * 1609.34)
      : null, // miles to meters
    floors_climbed: summary.floors || null,
    active_minutes:
      (summary.fairlyActiveMinutes || 0) + (summary.veryActiveMinutes || 0) || null,
  };
}

/**
 * Normalize Fitbit sleep data
 */
export function normalizeFitbitSleep(rawData: any, customerId: string): NormalizedSleepData {
  // Fitbit sleep log format:
  // {
  //   dateOfSleep: "2026-01-16",
  //   duration: 28800000, // milliseconds
  //   efficiency: 92,
  //   levels: {
  //     summary: {
  //       deep: { minutes: 90 },
  //       light: { minutes: 240 },
  //       rem: { minutes: 120 },
  //       wake: { minutes: 30 }
  //     }
  //   }
  // }

  return {
    customer_id: customerId,
    source_type: 'fitbit',
    sleep_date: rawData.dateOfSleep || new Date().toISOString().split('T')[0],
    total_minutes: rawData.duration ? Math.round(rawData.duration / 60000) : null,
    deep_minutes: rawData.levels?.summary?.deep?.minutes || null,
    light_minutes: rawData.levels?.summary?.light?.minutes || null,
    rem_minutes: rawData.levels?.summary?.rem?.minutes || null,
    awake_minutes: rawData.levels?.summary?.wake?.minutes || null,
    efficiency: rawData.efficiency || null,
  };
}

/**
 * Normalize Fitbit heart rate data
 */
export function normalizeFitbitHeartRate(
  rawData: any,
  customerId: string
): NormalizedHeartRateData {
  // Fitbit heart rate format:
  // {
  //   date: "2026-01-16",
  //   value: {
  //     restingHeartRate: 62,
  //     heartRateZones: [...]
  //   },
  //   intraday: {
  //     dataset: [{time: "00:00:00", value: 58}, ...]
  //   }
  // }

  const intradayData = rawData.intraday?.dataset || [];
  const heartRates = intradayData.map((d: any) => d.value).filter((v: number) => v > 0);

  const avgHeartRate =
    heartRates.length > 0
      ? Math.round(heartRates.reduce((a: number, b: number) => a + b, 0) / heartRates.length)
      : null;

  const maxHeartRate = heartRates.length > 0 ? Math.max(...heartRates) : null;
  const minHeartRate = heartRates.length > 0 ? Math.min(...heartRates) : null;

  return {
    customer_id: customerId,
    source_type: 'fitbit',
    recorded_date: rawData.date || new Date().toISOString().split('T')[0],
    resting_heart_rate: rawData.value?.restingHeartRate || null,
    avg_heart_rate: avgHeartRate,
    max_heart_rate: maxHeartRate,
    min_heart_rate: minHeartRate,
  };
}

/**
 * Main normalization function that handles different Fitbit data types
 */
export function normalizeFitbitData(rawData: any, customerId: string): any[] {
  const results: any[] = [];

  // Detect data type and normalize accordingly
  if (rawData.summary) {
    // Activity data
    results.push(normalizeFitbitActivity(rawData, customerId));
  }

  if (rawData.sleep && Array.isArray(rawData.sleep)) {
    // Sleep data
    for (const sleepRecord of rawData.sleep) {
      results.push(normalizeFitbitSleep(sleepRecord, customerId));
    }
  }

  if (rawData.value?.restingHeartRate || rawData.intraday) {
    // Heart rate data
    results.push(normalizeFitbitHeartRate(rawData, customerId));
  }

  return results;
}
