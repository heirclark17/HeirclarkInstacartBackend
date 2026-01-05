// src/types/bodyScan.ts
// Body Scan & Recomposition Types for Heirclark
// Supports progress photos, body composition tracking, and AI-generated reports

// ==========================================================================
// Photo Types
// ==========================================================================

export type PhotoType = 'front' | 'side' | 'back';
export type PhotoCondition = 'fasted' | 'post_meal' | 'post_workout' | 'relaxed' | 'flexed';

export interface ProgressPhoto {
  id: string;
  user_id: string;

  photo_type: PhotoType;
  photo_url: string;
  thumbnail_url?: string;

  // Metadata
  taken_at: Date;
  condition?: PhotoCondition;
  lighting_notes?: string;

  // Associated measurements
  weight_lbs?: number;
  body_fat_percent?: number;

  // Tags
  tags?: string[];

  created_at: Date;
}

// ==========================================================================
// Body Measurement Types
// ==========================================================================

export interface BodyMeasurement {
  id: string;
  user_id: string;
  measured_at: Date;

  // Required
  weight_lbs: number;

  // Body composition (optional, from scan or estimate)
  body_fat_percent?: number;
  lean_mass_lbs?: number;
  fat_mass_lbs?: number;

  // Circumferences (optional)
  waist_inches?: number;
  hip_inches?: number;
  chest_inches?: number;
  arm_inches?: number;
  thigh_inches?: number;
  neck_inches?: number;

  // Calculated metrics
  bmi?: number;
  waist_to_hip_ratio?: number;

  // Source
  source: 'manual' | 'smart_scale' | 'dexa' | 'bodpod' | 'navy_method' | 'ai_estimate';
  device_name?: string;

  created_at: Date;
}

// ==========================================================================
// Comparison Types
// ==========================================================================

export interface PhotoComparison {
  photo_before: ProgressPhoto;
  photo_after: ProgressPhoto;
  days_between: number;

  // AI analysis
  ai_analysis?: {
    visible_changes: string[];
    areas_of_progress: string[];
    confidence_score: number;  // 0-1
    narrative: string;
  };

  // Measurement changes
  measurement_changes?: {
    weight_change_lbs?: number;
    body_fat_change_percent?: number;
    lean_mass_change_lbs?: number;
  };
}

export interface MeasurementTrend {
  metric: string;
  unit: string;
  data_points: Array<{
    date: Date;
    value: number;
  }>;

  // Trend analysis
  trend_direction: 'increasing' | 'decreasing' | 'stable';
  trend_rate_per_week: number;
  projected_value_30d?: number;
}

// ==========================================================================
// Recomposition Report Types
// ==========================================================================

export interface RecompositionReport {
  id: string;
  user_id: string;
  generated_at: Date;

  // Time period
  period_start: Date;
  period_end: Date;
  duration_days: number;

  // Starting point
  start_weight_lbs: number;
  start_body_fat_percent?: number;
  start_lean_mass_lbs?: number;

  // Ending point
  end_weight_lbs: number;
  end_body_fat_percent?: number;
  end_lean_mass_lbs?: number;

  // Changes
  weight_change_lbs: number;
  body_fat_change_percent?: number;
  lean_mass_change_lbs?: number;
  fat_mass_change_lbs?: number;

  // Photos
  photo_comparison?: PhotoComparison;

  // Nutrition averages during period
  nutrition_averages: {
    daily_calories: number;
    daily_protein_g: number;
    daily_carbs_g: number;
    daily_fat_g: number;
    calorie_adherence_percent: number;
    protein_adherence_percent: number;
  };

  // Activity during period
  activity_summary: {
    workouts_per_week: number;
    total_active_minutes: number;
    avg_steps_per_day: number;
  };

  // AI-generated content
  ai_summary: string;
  ai_highlights: string[];
  ai_recommendations: string[];
  ai_projected_progress?: {
    weeks_to_goal: number;
    confidence: number;
    assumptions: string[];
  };

  // Overall assessment
  recomp_score: number;  // 0-100, composite score
  phase_detected: 'cutting' | 'bulking' | 'maintaining' | 'recomping';
}

// ==========================================================================
// Goal & Projection Types
// ==========================================================================

export interface BodyGoal {
  id: string;
  user_id: string;

  goal_type: 'weight_loss' | 'muscle_gain' | 'body_fat_reduction' | 'maintenance' | 'recomposition';

  // Target metrics
  target_weight_lbs?: number;
  target_body_fat_percent?: number;
  target_lean_mass_lbs?: number;

  // Timeline
  target_date?: Date;
  aggressive: boolean;  // Faster rate, more aggressive deficit/surplus

  // Current values (snapshot when goal set)
  starting_weight_lbs: number;
  starting_body_fat_percent?: number;

  // Progress
  current_weight_lbs: number;
  current_body_fat_percent?: number;
  percent_complete: number;

  // Status
  status: 'active' | 'achieved' | 'abandoned' | 'paused';

  created_at: Date;
  updated_at: Date;
}

export interface ProgressProjection {
  goal: BodyGoal;

  // Linear projection
  weeks_to_goal: number;
  weekly_rate: number;  // lbs per week
  projected_completion_date: Date;

  // Confidence bounds
  optimistic_weeks: number;
  pessimistic_weeks: number;
  confidence_level: number;  // 0-1

  // Recommendations
  on_track: boolean;
  adjustment_needed?: string;

  // Milestones
  milestones: Array<{
    name: string;
    target_value: number;
    target_date: Date;
    achieved: boolean;
  }>;
}

// ==========================================================================
// Timeline Types
// ==========================================================================

export interface BodyTimeline {
  user_id: string;

  // Grouped by month
  months: Array<{
    month: string;  // "2024-01"
    photos: ProgressPhoto[];
    measurements: BodyMeasurement[];
    avg_weight_lbs: number;
    weight_change_lbs: number;  // vs previous month
  }>;

  // Key milestones
  milestones: Array<{
    date: Date;
    type: 'lowest_weight' | 'highest_weight' | 'best_body_fat' | 'goal_achieved' | 'custom';
    description: string;
    value: number;
  }>;
}

// ==========================================================================
// API Response Types
// ==========================================================================

export interface PhotoUploadResponse {
  photo: ProgressPhoto;
  ai_feedback?: {
    quality_score: number;  // 0-100
    lighting_feedback: string;
    pose_feedback: string;
    suggestions: string[];
  };
}

export interface ComparisonResponse {
  comparison: PhotoComparison;
  measurement_trends: MeasurementTrend[];
  period_summary: {
    total_weight_change_lbs: number;
    avg_weekly_change_lbs: number;
    consistency_score: number;
  };
}

export interface ReportGenerationRequest {
  period_start?: Date;
  period_end?: Date;
  duration_days?: number;  // Alternative to explicit dates
  include_photos?: boolean;
  include_ai_analysis?: boolean;
}
