// src/types/programs.ts
// Program Types for Heirclark Behavior Change Platform
// Supports onboarding, structured programs, and habit building

// ==========================================================================
// Program Structure Types
// ==========================================================================

export type ProgramType =
  | 'onboarding'        // 7-day activation program
  | 'weight_loss'       // Structured weight loss program
  | 'muscle_gain'       // Muscle building program
  | 'maintenance'       // Weight maintenance
  | 'habit_building'    // General habit formation
  | 'challenge';        // Time-limited challenge

export type ProgramStatus =
  | 'available'         // Can be started
  | 'active'            // Currently in progress
  | 'completed'         // Finished successfully
  | 'abandoned'         // User quit
  | 'paused';           // Temporarily paused

export type DayStatus =
  | 'locked'            // Not yet available
  | 'available'         // Ready to start
  | 'in_progress'       // Started but not complete
  | 'completed'         // All tasks done
  | 'skipped';          // User skipped this day

export type TaskType =
  | 'lesson'            // Educational content (CBT-based)
  | 'reflection'        // Self-reflection prompt
  | 'action'            // Do something (log meal, weigh in, etc.)
  | 'quiz'              // Knowledge check
  | 'goal_setting'      // Set a specific goal
  | 'habit_check'       // Check off a habit
  | 'coach_video';      // Watch AI coach video

// ==========================================================================
// Program Definition Types
// ==========================================================================

export interface Program {
  id: string;
  type: ProgramType;
  name: string;
  description: string;
  duration_days: number;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  category: string;

  // Program content
  days: ProgramDay[];

  // Completion criteria
  min_completion_rate: number;  // 0-1, e.g., 0.7 = 70% of tasks required

  // Metadata
  thumbnail_url?: string;
  coach_name?: string;
  estimated_daily_minutes: number;

  // Prerequisites
  requires_programs?: string[];  // Must complete these first

  created_at: Date;
  updated_at: Date;
}

export interface ProgramDay {
  day: number;
  title: string;
  subtitle?: string;
  theme?: string;  // e.g., "Understanding Hunger Cues"

  // Tasks for this day
  tasks: ProgramTask[];

  // Unlock criteria
  unlock_after_days?: number;  // Days since program start
  unlock_after_tasks?: string[];  // Task IDs that must be completed

  // Coach interaction
  coach_intro_script?: string;
  coach_outro_script?: string;

  estimated_minutes: number;
}

export interface ProgramTask {
  id: string;
  type: TaskType;
  title: string;
  description?: string;

  // Task content (varies by type)
  content: TaskContent;

  // Completion
  required: boolean;
  points?: number;

  // Ordering
  order: number;

  // Time estimate
  estimated_minutes: number;
}

export type TaskContent =
  | LessonContent
  | ReflectionContent
  | ActionContent
  | QuizContent
  | GoalSettingContent
  | HabitCheckContent
  | CoachVideoContent;

export interface LessonContent {
  type: 'lesson';
  body_markdown: string;
  key_takeaways: string[];
  cbt_technique?: string;  // e.g., "cognitive_restructuring", "behavioral_activation"
  image_url?: string;
  audio_url?: string;
}

export interface ReflectionContent {
  type: 'reflection';
  prompt: string;
  example_response?: string;
  min_characters?: number;
  follow_up_prompts?: string[];
}

export interface ActionContent {
  type: 'action';
  action_type: 'log_meal' | 'log_weight' | 'log_exercise' | 'take_photo' | 'custom';
  instructions: string;
  verification_method: 'self_report' | 'app_data' | 'photo_upload';
  deep_link?: string;  // Link to relevant app section
}

export interface QuizContent {
  type: 'quiz';
  questions: QuizQuestion[];
  passing_score: number;  // 0-100
  show_correct_answers: boolean;
}

export interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  correct_index: number;
  explanation?: string;
}

export interface GoalSettingContent {
  type: 'goal_setting';
  goal_category: 'weight' | 'nutrition' | 'exercise' | 'habit' | 'mindset';
  prompt: string;
  suggestions?: string[];
  smart_criteria: boolean;  // Guide user through SMART goal format
}

export interface HabitCheckContent {
  type: 'habit_check';
  habit_name: string;
  habit_description: string;
  frequency: 'daily' | 'weekly';
  streak_bonus_points?: number;
}

export interface CoachVideoContent {
  type: 'coach_video';
  video_url?: string;  // Pre-recorded
  generate_script: boolean;  // Use AI to generate personalized script
  script_template?: string;
  avatar_id?: string;
}

// ==========================================================================
// User Progress Types
// ==========================================================================

export interface UserProgramEnrollment {
  id: string;
  user_id: string;  // Shopify customer ID
  program_id: string;

  status: ProgramStatus;
  started_at: Date;
  completed_at?: Date;
  paused_at?: Date;

  // Progress tracking
  current_day: number;
  days_completed: number;
  tasks_completed: number;
  total_tasks: number;
  completion_rate: number;  // 0-1

  // Engagement metrics
  total_time_spent_minutes: number;
  streak_days: number;
  longest_streak: number;
  points_earned: number;

  // User responses (for reflections, goals, etc.)
  responses: UserTaskResponse[];
}

export interface UserDayProgress {
  id: string;
  enrollment_id: string;
  day: number;

  status: DayStatus;
  started_at?: Date;
  completed_at?: Date;

  tasks_completed: number;
  total_tasks: number;
  time_spent_minutes: number;
}

export interface UserTaskResponse {
  id: string;
  enrollment_id: string;
  task_id: string;
  day: number;

  completed: boolean;
  completed_at?: Date;
  time_spent_seconds?: number;

  // Response data (varies by task type)
  response_data?: TaskResponseData;

  // Quiz results
  quiz_score?: number;
  quiz_passed?: boolean;

  // Points
  points_awarded: number;
}

export interface TaskResponseData {
  reflection_text?: string;
  goal_text?: string;
  quiz_answers?: number[];
  habit_completed?: boolean;
  photo_url?: string;
  custom_data?: Record<string, any>;
}

// ==========================================================================
// Onboarding-Specific Types
// ==========================================================================

export interface OnboardingConfig {
  // Day 1: Profile & Goals
  day1: {
    collect_biometrics: boolean;
    collect_activity_level: boolean;
    collect_goal_type: boolean;
    calculate_tdee: boolean;
  };

  // Day 2: Nutrition Basics
  day2: {
    explain_macros: boolean;
    set_macro_targets: boolean;
    first_meal_log: boolean;
  };

  // Day 3: Understanding Hunger
  day3: {
    hunger_scale_lesson: boolean;
    hunger_reflection: boolean;
  };

  // Day 4: Meal Planning Intro
  day4: {
    generate_sample_plan: boolean;
    grocery_list_preview: boolean;
  };

  // Day 5: Building Habits
  day5: {
    habit_stacking_lesson: boolean;
    choose_keystone_habit: boolean;
  };

  // Day 6: Tracking & Progress
  day6: {
    photo_progress_intro: boolean;
    metrics_dashboard_tour: boolean;
  };

  // Day 7: Your Journey Ahead
  day7: {
    program_recommendations: boolean;
    commitment_reflection: boolean;
    unlock_full_features: boolean;
  };
}

// ==========================================================================
// Habit Loop Types (Noom-style)
// ==========================================================================

export interface HabitLoop {
  id: string;
  user_id: string;

  // Habit definition
  habit_name: string;
  cue: string;           // What triggers the habit
  routine: string;       // The behavior itself
  reward: string;        // The positive outcome

  // Tracking
  frequency: 'daily' | 'weekly' | 'custom';
  custom_days?: number[];  // 0=Sun, 6=Sat
  target_time?: string;    // HH:MM

  // Progress
  current_streak: number;
  longest_streak: number;
  total_completions: number;
  completion_rate: number;

  // Gamification
  level: number;
  points_per_completion: number;

  created_at: Date;
  updated_at: Date;
}

export interface HabitCompletion {
  id: string;
  habit_id: string;
  user_id: string;
  completed_at: Date;
  notes?: string;
  mood_rating?: number;  // 1-5
  points_awarded: number;
}

// ==========================================================================
// Notification & Reminder Types
// ==========================================================================

export interface ProgramReminder {
  id: string;
  user_id: string;
  program_id?: string;
  habit_id?: string;

  type: 'program_day' | 'habit_reminder' | 'streak_risk' | 'milestone';

  scheduled_at: Date;
  sent_at?: Date;

  title: string;
  body: string;
  deep_link?: string;

  // Push notification config
  push_enabled: boolean;
  email_enabled: boolean;
}

// ==========================================================================
// Analytics Types
// ==========================================================================

export interface ProgramAnalytics {
  program_id: string;
  period: 'day' | 'week' | 'month' | 'all_time';

  // Enrollment metrics
  total_enrollments: number;
  active_enrollments: number;
  completed_enrollments: number;
  abandoned_enrollments: number;

  // Engagement metrics
  avg_completion_rate: number;
  avg_time_per_day_minutes: number;
  avg_streak_length: number;

  // Day-level drop-off
  drop_off_by_day: { day: number; remaining_pct: number }[];

  // Task engagement
  most_engaged_tasks: { task_id: string; completion_rate: number }[];
  least_engaged_tasks: { task_id: string; completion_rate: number }[];
}

// ==========================================================================
// API Response Types
// ==========================================================================

export interface ProgramListResponse {
  available: Program[];
  in_progress: UserProgramEnrollment[];
  completed: UserProgramEnrollment[];
}

export interface ProgramDayResponse {
  day: ProgramDay;
  progress: UserDayProgress;
  tasks_with_responses: Array<{
    task: ProgramTask;
    response?: UserTaskResponse;
  }>;
  can_proceed: boolean;
  next_day_unlocks_at?: Date;
}

export interface TaskCompleteResponse {
  success: boolean;
  points_awarded: number;
  new_total_points: number;
  streak_updated: boolean;
  new_streak: number;
  day_completed: boolean;
  program_completed: boolean;
  unlocked_rewards?: string[];
}
