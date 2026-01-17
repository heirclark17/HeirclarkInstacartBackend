import { NormalizedActivityData, NormalizedSleepData, NormalizedHeartRateData } from './fitbitNormalizer';

/**
 * Normalize Google Fit activity data
 */
export function normalizeGoogleFitActivity(
  rawData: any,
  customerId: string
): NormalizedActivityData {
  // Google Fit activity format:
  // {
  //   date: "2026-01-16",
  //   steps: 8500,
  //   calories: 2200,
  //   distance: 5200, // meters
  //   moveMinutes: 45
  // }

  return {
    customer_id: customerId,
    source_type: 'google-fit',
    recorded_date: rawData.date || new Date().toISOString().split('T')[0],
    steps: rawData.steps || null,
    active_calories: rawData.calories || null,
    resting_calories: null, // Google Fit doesn't separate resting calories
    distance_meters: rawData.distance || null,
    floors_climbed: null, // Google Fit doesn't track floors
    active_minutes: rawData.moveMinutes || null,
  };
}

/**
 * Normalize Google Fit sleep data
 */
export function normalizeGoogleFitSleep(
  rawData: any,
  customerId: string
): NormalizedSleepData {
  // Google Fit sleep format:
  // {
  //   date: "2026-01-16",
  //   sleepType: "sleep",
  //   duration: 480, // minutes
  //   stages: {
  //     deep: 90,
  //     light: 240,
  //     rem: 120,
  //     awake: 30
  //   }
  // }

  return {
    customer_id: customerId,
    source_type: 'google-fit',
    sleep_date: rawData.date || new Date().toISOString().split('T')[0],
    total_minutes: rawData.duration || null,
    deep_minutes: rawData.stages?.deep || null,
    light_minutes: rawData.stages?.light || null,
    rem_minutes: rawData.stages?.rem || null,
    awake_minutes: rawData.stages?.awake || null,
    efficiency: null, // Google Fit doesn't calculate sleep efficiency
  };
}

/**
 * Normalize Google Fit heart rate data
 */
export function normalizeGoogleFitHeartRate(
  rawData: any,
  customerId: string
): NormalizedHeartRateData {
  // Google Fit heart rate format:
  // {
  //   date: "2026-01-16",
  //   dataPoints: [
  //     {timestamp: "2026-01-16T08:00:00", bpm: 65},
  //     {timestamp: "2026-01-16T09:00:00", bpm: 72},
  //     ...
  //   ]
  // }

  const dataPoints = rawData.dataPoints || [];
  const bpmValues = dataPoints.map((d: any) => d.bpm).filter((v: number) => v > 0);

  const avgHeartRate =
    bpmValues.length > 0
      ? Math.round(bpmValues.reduce((a: number, b: number) => a + b, 0) / bpmValues.length)
      : null;

  const maxHeartRate = bpmValues.length > 0 ? Math.max(...bpmValues) : null;
  const minHeartRate = bpmValues.length > 0 ? Math.min(...bpmValues) : null;

  // Google Fit doesn't provide explicit resting heart rate, so use minimum as approximation
  const restingHeartRate = minHeartRate;

  return {
    customer_id: customerId,
    source_type: 'google-fit',
    recorded_date: rawData.date || new Date().toISOString().split('T')[0],
    resting_heart_rate: restingHeartRate,
    avg_heart_rate: avgHeartRate,
    max_heart_rate: maxHeartRate,
    min_heart_rate: minHeartRate,
  };
}

/**
 * Main normalization function for Google Fit data
 */
export function normalizeGoogleFitData(rawData: any, customerId: string): any[] {
  const results: any[] = [];

  // Handle array of daily activity records
  if (Array.isArray(rawData)) {
    for (const record of rawData) {
      if (record.steps !== undefined || record.calories !== undefined) {
        results.push(normalizeGoogleFitActivity(record, customerId));
      }

      if (record.duration !== undefined && record.sleepType) {
        results.push(normalizeGoogleFitSleep(record, customerId));
      }

      if (record.dataPoints && record.dataPoints.length > 0) {
        results.push(normalizeGoogleFitHeartRate(record, customerId));
      }
    }
  } else {
    // Handle single record
    if (rawData.steps !== undefined || rawData.calories !== undefined) {
      results.push(normalizeGoogleFitActivity(rawData, customerId));
    }

    if (rawData.duration !== undefined && rawData.sleepType) {
      results.push(normalizeGoogleFitSleep(rawData, customerId));
    }

    if (rawData.dataPoints && rawData.dataPoints.length > 0) {
      results.push(normalizeGoogleFitHeartRate(rawData, customerId));
    }
  }

  return results;
}
