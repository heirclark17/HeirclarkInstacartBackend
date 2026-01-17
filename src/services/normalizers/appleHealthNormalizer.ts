import { NormalizedActivityData, NormalizedSleepData, NormalizedHeartRateData } from './fitbitNormalizer';

/**
 * Normalize Apple Health CSV query results
 */
export function normalizeAppleHealthActivity(
  rawData: any,
  customerId: string
): NormalizedActivityData {
  // Apple Health query result format (from DuckDB SQL query):
  // {
  //   date: "2026-01-16",
  //   steps: 8500,
  //   active_energy: 500,
  //   resting_energy: 1600,
  //   distance: 5200, // meters
  //   flights_climbed: 10
  // }

  return {
    customer_id: customerId,
    source_type: 'apple-health',
    recorded_date: rawData.date || new Date().toISOString().split('T')[0],
    steps: rawData.steps || rawData.step_count || null,
    active_calories: rawData.active_energy || rawData.active_calories || null,
    resting_calories: rawData.resting_energy || rawData.basal_energy || null,
    distance_meters: rawData.distance || rawData.distance_walking_running || null,
    floors_climbed: rawData.flights_climbed || rawData.floors || null,
    active_minutes: rawData.active_minutes || rawData.exercise_minutes || null,
  };
}

/**
 * Normalize Apple Health sleep data
 */
export function normalizeAppleHealthSleep(
  rawData: any,
  customerId: string
): NormalizedSleepData {
  // Apple Health sleep format (from CSV):
  // {
  //   date: "2026-01-16",
  //   sleep_analysis_asleep: 480, // minutes
  //   sleep_analysis_in_bed: 510,
  //   sleep_analysis_awake: 30,
  //   deep_sleep: 90,
  //   core_sleep: 240,
  //   rem_sleep: 120
  // }

  const totalMinutes = rawData.sleep_analysis_asleep || rawData.total_sleep_time || null;
  const inBedMinutes = rawData.sleep_analysis_in_bed || null;
  const efficiency =
    totalMinutes && inBedMinutes ? Math.round((totalMinutes / inBedMinutes) * 100) : null;

  return {
    customer_id: customerId,
    source_type: 'apple-health',
    sleep_date: rawData.date || new Date().toISOString().split('T')[0],
    total_minutes: totalMinutes,
    deep_minutes: rawData.deep_sleep || rawData.sleep_analysis_deep || null,
    light_minutes: rawData.core_sleep || rawData.sleep_analysis_core || null,
    rem_minutes: rawData.rem_sleep || rawData.sleep_analysis_rem || null,
    awake_minutes: rawData.sleep_analysis_awake || null,
    efficiency: efficiency,
  };
}

/**
 * Normalize Apple Health heart rate data
 */
export function normalizeAppleHealthHeartRate(
  rawData: any,
  customerId: string
): NormalizedHeartRateData {
  // Apple Health heart rate format:
  // {
  //   date: "2026-01-16",
  //   resting_heart_rate: 62,
  //   heart_rate_avg: 75,
  //   heart_rate_max: 145,
  //   heart_rate_min: 58
  // }

  return {
    customer_id: customerId,
    source_type: 'apple-health',
    recorded_date: rawData.date || new Date().toISOString().split('T')[0],
    resting_heart_rate: rawData.resting_heart_rate || null,
    avg_heart_rate: rawData.heart_rate_avg || rawData.heart_rate_average || null,
    max_heart_rate: rawData.heart_rate_max || rawData.heart_rate_maximum || null,
    min_heart_rate: rawData.heart_rate_min || rawData.heart_rate_minimum || null,
  };
}

/**
 * Main normalization function for Apple Health data
 */
export function normalizeAppleHealthData(rawData: any, customerId: string): any[] {
  const results: any[] = [];

  // Apple Health returns SQL query results, which could be an array of rows
  const rows = Array.isArray(rawData) ? rawData : [rawData];

  for (const row of rows) {
    // Check what type of data this row contains and normalize accordingly
    const hasActivityData =
      row.steps !== undefined ||
      row.step_count !== undefined ||
      row.active_energy !== undefined;

    const hasSleepData =
      row.sleep_analysis_asleep !== undefined || row.total_sleep_time !== undefined;

    const hasHeartRateData =
      row.resting_heart_rate !== undefined ||
      row.heart_rate_avg !== undefined ||
      row.heart_rate_average !== undefined;

    if (hasActivityData) {
      results.push(normalizeAppleHealthActivity(row, customerId));
    }

    if (hasSleepData) {
      results.push(normalizeAppleHealthSleep(row, customerId));
    }

    if (hasHeartRateData) {
      results.push(normalizeAppleHealthHeartRate(row, customerId));
    }
  }

  return results;
}
