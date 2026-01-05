// src/db/programs.ts
// Programs Database Layer for Heirclark Behavior Change Platform
// Handles program definitions, user enrollments, and progress tracking

import { Pool } from 'pg';
import {
  Program,
  ProgramDay,
  ProgramTask,
  UserProgramEnrollment,
  UserDayProgress,
  UserTaskResponse,
  ProgramStatus,
  DayStatus,
  HabitLoop,
  HabitCompletion,
  TaskResponseData,
} from '../types/programs';

// ==========================================================================
// SQL Migrations
// ==========================================================================

export const PROGRAMS_SCHEMA = `
-- Programs table (definitions)
CREATE TABLE IF NOT EXISTS hc_programs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type VARCHAR(50) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  duration_days INTEGER NOT NULL,
  difficulty VARCHAR(20) DEFAULT 'beginner',
  category VARCHAR(100),

  days JSONB NOT NULL DEFAULT '[]',
  min_completion_rate DECIMAL(3,2) DEFAULT 0.70,

  thumbnail_url TEXT,
  coach_name VARCHAR(100),
  estimated_daily_minutes INTEGER DEFAULT 15,
  requires_programs UUID[],

  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- User program enrollments
CREATE TABLE IF NOT EXISTS hc_program_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(100) NOT NULL,  -- Shopify customer ID
  program_id UUID NOT NULL REFERENCES hc_programs(id),

  status VARCHAR(20) DEFAULT 'active',
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  paused_at TIMESTAMPTZ,

  current_day INTEGER DEFAULT 1,
  days_completed INTEGER DEFAULT 0,
  tasks_completed INTEGER DEFAULT 0,
  total_tasks INTEGER DEFAULT 0,
  completion_rate DECIMAL(3,2) DEFAULT 0,

  total_time_spent_minutes INTEGER DEFAULT 0,
  streak_days INTEGER DEFAULT 0,
  longest_streak INTEGER DEFAULT 0,
  points_earned INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(user_id, program_id)
);

-- Day-level progress
CREATE TABLE IF NOT EXISTS hc_program_day_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id UUID NOT NULL REFERENCES hc_program_enrollments(id) ON DELETE CASCADE,
  day INTEGER NOT NULL,

  status VARCHAR(20) DEFAULT 'locked',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  tasks_completed INTEGER DEFAULT 0,
  total_tasks INTEGER DEFAULT 0,
  time_spent_minutes INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(enrollment_id, day)
);

-- Task responses
CREATE TABLE IF NOT EXISTS hc_program_task_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id UUID NOT NULL REFERENCES hc_program_enrollments(id) ON DELETE CASCADE,
  task_id VARCHAR(100) NOT NULL,
  day INTEGER NOT NULL,

  completed BOOLEAN DEFAULT false,
  completed_at TIMESTAMPTZ,
  time_spent_seconds INTEGER,

  response_data JSONB,
  quiz_score INTEGER,
  quiz_passed BOOLEAN,

  points_awarded INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(enrollment_id, task_id)
);

-- Habit loops
CREATE TABLE IF NOT EXISTS hc_habit_loops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(100) NOT NULL,

  habit_name VARCHAR(255) NOT NULL,
  cue TEXT,
  routine TEXT,
  reward TEXT,

  frequency VARCHAR(20) DEFAULT 'daily',
  custom_days INTEGER[],
  target_time TIME,

  current_streak INTEGER DEFAULT 0,
  longest_streak INTEGER DEFAULT 0,
  total_completions INTEGER DEFAULT 0,
  completion_rate DECIMAL(3,2) DEFAULT 0,

  level INTEGER DEFAULT 1,
  points_per_completion INTEGER DEFAULT 10,

  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Habit completions
CREATE TABLE IF NOT EXISTS hc_habit_completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  habit_id UUID NOT NULL REFERENCES hc_habit_loops(id) ON DELETE CASCADE,
  user_id VARCHAR(100) NOT NULL,

  completed_at TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT,
  mood_rating INTEGER,
  points_awarded INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Program reminders
CREATE TABLE IF NOT EXISTS hc_program_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(100) NOT NULL,
  program_id UUID REFERENCES hc_programs(id),
  habit_id UUID REFERENCES hc_habit_loops(id),

  type VARCHAR(50) NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,

  title VARCHAR(255) NOT NULL,
  body TEXT,
  deep_link TEXT,

  push_enabled BOOLEAN DEFAULT true,
  email_enabled BOOLEAN DEFAULT false,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_enrollments_user ON hc_program_enrollments(user_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_status ON hc_program_enrollments(status);
CREATE INDEX IF NOT EXISTS idx_day_progress_enrollment ON hc_program_day_progress(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_task_responses_enrollment ON hc_program_task_responses(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_habits_user ON hc_habit_loops(user_id);
CREATE INDEX IF NOT EXISTS idx_habit_completions_habit ON hc_habit_completions(habit_id);
CREATE INDEX IF NOT EXISTS idx_reminders_scheduled ON hc_program_reminders(scheduled_at) WHERE sent_at IS NULL;
`;

// ==========================================================================
// Programs Database Class
// ==========================================================================

export class ProgramsDB {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  // ==========================================================================
  // Schema Management
  // ==========================================================================

  async initializeSchema(): Promise<void> {
    await this.pool.query(PROGRAMS_SCHEMA);
    console.log('[ProgramsDB] Schema initialized');
  }

  // ==========================================================================
  // Program Definitions
  // ==========================================================================

  async getProgram(programId: string): Promise<Program | null> {
    const result = await this.pool.query(
      'SELECT * FROM hc_programs WHERE id = $1 AND is_active = true',
      [programId]
    );
    return result.rows[0] ? this.mapProgramRow(result.rows[0]) : null;
  }

  async listPrograms(type?: string): Promise<Program[]> {
    let sql = 'SELECT * FROM hc_programs WHERE is_active = true';
    const params: any[] = [];

    if (type) {
      sql += ' AND type = $1';
      params.push(type);
    }

    sql += ' ORDER BY created_at DESC';

    const result = await this.pool.query(sql, params);
    return result.rows.map(this.mapProgramRow);
  }

  async createProgram(program: Partial<Program>): Promise<Program> {
    const result = await this.pool.query(
      `INSERT INTO hc_programs (type, name, description, duration_days, difficulty, category,
        days, min_completion_rate, thumbnail_url, coach_name, estimated_daily_minutes, requires_programs)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        program.type,
        program.name,
        program.description,
        program.duration_days,
        program.difficulty || 'beginner',
        program.category,
        JSON.stringify(program.days || []),
        program.min_completion_rate || 0.7,
        program.thumbnail_url,
        program.coach_name,
        program.estimated_daily_minutes || 15,
        program.requires_programs || [],
      ]
    );
    return this.mapProgramRow(result.rows[0]);
  }

  // ==========================================================================
  // User Enrollments
  // ==========================================================================

  async enrollUser(userId: string, programId: string): Promise<UserProgramEnrollment> {
    const program = await this.getProgram(programId);
    if (!program) {
      throw new Error('Program not found');
    }

    // Calculate total tasks from hc_tasks table (preferred) or fall back to days JSONB
    let totalTasks = 0;
    const taskCountResult = await this.pool.query(
      `SELECT COUNT(*) as count FROM hc_tasks WHERE program_id = $1`,
      [programId]
    );
    totalTasks = parseInt(taskCountResult.rows[0]?.count || '0');

    // Fall back to JSONB days if no tasks in hc_tasks table
    if (totalTasks === 0 && program.days && program.days.length > 0) {
      totalTasks = program.days.reduce((sum, day) => sum + (day.tasks?.length || 0), 0);
    }

    const result = await this.pool.query(
      `INSERT INTO hc_program_enrollments (user_id, program_id, total_tasks)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, program_id) DO UPDATE SET
         status = 'active',
         started_at = NOW(),
         updated_at = NOW()
       RETURNING *`,
      [userId, programId, totalTasks]
    );

    const enrollment = this.mapEnrollmentRow(result.rows[0]);

    // Initialize day 1 as available - get task count for day 1 from hc_tasks table
    const day1TasksResult = await this.pool.query(
      `SELECT COUNT(*) as count FROM hc_tasks WHERE program_id = $1 AND day_number = 1`,
      [programId]
    );
    const day1TaskCount = parseInt(day1TasksResult.rows[0]?.count || '0');

    if (day1TaskCount > 0) {
      // Initialize with task count from hc_tasks table
      await this.pool.query(
        `INSERT INTO hc_program_day_progress (enrollment_id, day, status, total_tasks)
         VALUES ($1, 1, 'available', $2)
         ON CONFLICT (enrollment_id, day) DO NOTHING`,
        [enrollment.id, day1TaskCount]
      );
    } else if (program.days && program.days[0]) {
      // Fall back to JSONB days
      await this.initializeDayProgress(enrollment.id, 1, program.days[0]);
    }

    return enrollment;
  }

  async getEnrollment(enrollmentId: string): Promise<UserProgramEnrollment | null> {
    const result = await this.pool.query(
      'SELECT * FROM hc_program_enrollments WHERE id = $1',
      [enrollmentId]
    );
    return result.rows[0] ? this.mapEnrollmentRow(result.rows[0]) : null;
  }

  async getUserEnrollments(userId: string): Promise<UserProgramEnrollment[]> {
    const result = await this.pool.query(
      `SELECT * FROM hc_program_enrollments
       WHERE user_id = $1
       ORDER BY updated_at DESC`,
      [userId]
    );
    return result.rows.map(this.mapEnrollmentRow);
  }

  async updateEnrollmentStatus(enrollmentId: string, status: ProgramStatus): Promise<void> {
    const updates: any = { status, updated_at: new Date() };

    if (status === 'completed') {
      updates.completed_at = new Date();
    } else if (status === 'paused') {
      updates.paused_at = new Date();
    }

    const setClauses = Object.keys(updates).map((key, i) => `${key} = $${i + 2}`);
    await this.pool.query(
      `UPDATE hc_program_enrollments SET ${setClauses.join(', ')} WHERE id = $1`,
      [enrollmentId, ...Object.values(updates)]
    );
  }

  // ==========================================================================
  // Day Progress
  // ==========================================================================

  async initializeDayProgress(enrollmentId: string, day: number, dayDef: ProgramDay): Promise<void> {
    await this.pool.query(
      `INSERT INTO hc_program_day_progress (enrollment_id, day, status, total_tasks)
       VALUES ($1, $2, 'available', $3)
       ON CONFLICT (enrollment_id, day) DO NOTHING`,
      [enrollmentId, day, dayDef.tasks.length]
    );
  }

  async getDayProgress(enrollmentId: string, day: number): Promise<UserDayProgress | null> {
    const result = await this.pool.query(
      'SELECT * FROM hc_program_day_progress WHERE enrollment_id = $1 AND day = $2',
      [enrollmentId, day]
    );
    return result.rows[0] ? this.mapDayProgressRow(result.rows[0]) : null;
  }

  async startDay(enrollmentId: string, day: number): Promise<void> {
    await this.pool.query(
      `UPDATE hc_program_day_progress
       SET status = 'in_progress', started_at = NOW()
       WHERE enrollment_id = $1 AND day = $2 AND status = 'available'`,
      [enrollmentId, day]
    );
  }

  async completeDay(enrollmentId: string, day: number): Promise<void> {
    await this.pool.query(
      `UPDATE hc_program_day_progress
       SET status = 'completed', completed_at = NOW()
       WHERE enrollment_id = $1 AND day = $2`,
      [enrollmentId, day]
    );

    // Update enrollment
    await this.pool.query(
      `UPDATE hc_program_enrollments
       SET days_completed = days_completed + 1,
           current_day = $2 + 1,
           streak_days = streak_days + 1,
           longest_streak = GREATEST(longest_streak, streak_days + 1),
           updated_at = NOW()
       WHERE id = $1`,
      [enrollmentId, day]
    );
  }

  // ==========================================================================
  // Task Responses
  // ==========================================================================

  async getTaskResponses(enrollmentId: string, day?: number): Promise<UserTaskResponse[]> {
    let sql = 'SELECT * FROM hc_program_task_responses WHERE enrollment_id = $1';
    const params: any[] = [enrollmentId];

    if (day !== undefined) {
      sql += ' AND day = $2';
      params.push(day);
    }

    sql += ' ORDER BY created_at';

    const result = await this.pool.query(sql, params);
    return result.rows.map(this.mapTaskResponseRow);
  }

  async completeTask(
    enrollmentId: string,
    taskId: string,
    day: number,
    responseData?: TaskResponseData,
    quizScore?: number,
    quizPassed?: boolean,
    timeSpentSeconds?: number
  ): Promise<{ pointsAwarded: number }> {
    // Calculate points (base 10, bonus for streaks, quizzes, etc.)
    let points = 10;
    if (quizPassed) points += 5;
    if (responseData?.reflection_text && responseData.reflection_text.length > 100) points += 5;

    await this.pool.query(
      `INSERT INTO hc_program_task_responses
       (enrollment_id, task_id, day, completed, completed_at, response_data, quiz_score, quiz_passed, time_spent_seconds, points_awarded)
       VALUES ($1, $2, $3, true, NOW(), $4, $5, $6, $7, $8)
       ON CONFLICT (enrollment_id, task_id) DO UPDATE SET
         completed = true,
         completed_at = NOW(),
         response_data = COALESCE($4, hc_program_task_responses.response_data),
         quiz_score = COALESCE($5, hc_program_task_responses.quiz_score),
         quiz_passed = COALESCE($6, hc_program_task_responses.quiz_passed),
         time_spent_seconds = COALESCE($7, hc_program_task_responses.time_spent_seconds),
         points_awarded = $8`,
      [
        enrollmentId,
        taskId,
        day,
        responseData ? JSON.stringify(responseData) : null,
        quizScore,
        quizPassed,
        timeSpentSeconds,
        points,
      ]
    );

    // Update day progress
    await this.pool.query(
      `UPDATE hc_program_day_progress
       SET tasks_completed = tasks_completed + 1
       WHERE enrollment_id = $1 AND day = $2`,
      [enrollmentId, day]
    );

    // Update enrollment totals
    await this.pool.query(
      `UPDATE hc_program_enrollments
       SET tasks_completed = tasks_completed + 1,
           points_earned = points_earned + $2,
           completion_rate = CAST(tasks_completed + 1 AS DECIMAL) / NULLIF(total_tasks, 0),
           updated_at = NOW()
       WHERE id = $1`,
      [enrollmentId, points]
    );

    return { pointsAwarded: points };
  }

  // ==========================================================================
  // Habit Loops
  // ==========================================================================

  async createHabit(userId: string, habit: Partial<HabitLoop>): Promise<HabitLoop> {
    const result = await this.pool.query(
      `INSERT INTO hc_habit_loops (user_id, habit_name, cue, routine, reward, frequency, custom_days, target_time)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        userId,
        habit.habit_name,
        habit.cue,
        habit.routine,
        habit.reward,
        habit.frequency || 'daily',
        habit.custom_days,
        habit.target_time,
      ]
    );
    return this.mapHabitRow(result.rows[0]);
  }

  async getUserHabits(userId: string): Promise<HabitLoop[]> {
    const result = await this.pool.query(
      'SELECT * FROM hc_habit_loops WHERE user_id = $1 AND is_active = true ORDER BY created_at',
      [userId]
    );
    return result.rows.map(this.mapHabitRow);
  }

  async completeHabit(habitId: string, userId: string, notes?: string, moodRating?: number): Promise<HabitCompletion> {
    // Get habit for points
    const habitResult = await this.pool.query(
      'SELECT points_per_completion FROM hc_habit_loops WHERE id = $1',
      [habitId]
    );
    const points = habitResult.rows[0]?.points_per_completion || 10;

    // Record completion
    const result = await this.pool.query(
      `INSERT INTO hc_habit_completions (habit_id, user_id, notes, mood_rating, points_awarded)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [habitId, userId, notes, moodRating, points]
    );

    // Update habit stats
    await this.pool.query(
      `UPDATE hc_habit_loops
       SET total_completions = total_completions + 1,
           current_streak = current_streak + 1,
           longest_streak = GREATEST(longest_streak, current_streak + 1),
           updated_at = NOW()
       WHERE id = $1`,
      [habitId]
    );

    return this.mapHabitCompletionRow(result.rows[0]);
  }

  async getHabitCompletions(habitId: string, since?: Date): Promise<HabitCompletion[]> {
    let sql = 'SELECT * FROM hc_habit_completions WHERE habit_id = $1';
    const params: any[] = [habitId];

    if (since) {
      sql += ' AND completed_at >= $2';
      params.push(since);
    }

    sql += ' ORDER BY completed_at DESC';

    const result = await this.pool.query(sql, params);
    return result.rows.map(this.mapHabitCompletionRow);
  }

  // ==========================================================================
  // Row Mappers
  // ==========================================================================

  private mapProgramRow(row: any): Program {
    return {
      id: row.id,
      type: row.type,
      name: row.name,
      description: row.description,
      duration_days: row.duration_days,
      difficulty: row.difficulty,
      category: row.category,
      days: row.days || [],
      min_completion_rate: parseFloat(row.min_completion_rate),
      thumbnail_url: row.thumbnail_url,
      coach_name: row.coach_name,
      estimated_daily_minutes: row.estimated_daily_minutes,
      requires_programs: row.requires_programs,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  private mapEnrollmentRow(row: any): UserProgramEnrollment {
    return {
      id: row.id,
      user_id: row.user_id,
      program_id: row.program_id,
      status: row.status,
      started_at: row.started_at,
      completed_at: row.completed_at,
      paused_at: row.paused_at,
      current_day: row.current_day,
      days_completed: row.days_completed,
      tasks_completed: row.tasks_completed,
      total_tasks: row.total_tasks,
      completion_rate: parseFloat(row.completion_rate || 0),
      total_time_spent_minutes: row.total_time_spent_minutes,
      streak_days: row.streak_days,
      longest_streak: row.longest_streak,
      points_earned: row.points_earned,
      responses: [],
    };
  }

  private mapDayProgressRow(row: any): UserDayProgress {
    return {
      id: row.id,
      enrollment_id: row.enrollment_id,
      day: row.day,
      status: row.status,
      started_at: row.started_at,
      completed_at: row.completed_at,
      tasks_completed: row.tasks_completed,
      total_tasks: row.total_tasks,
      time_spent_minutes: row.time_spent_minutes,
    };
  }

  private mapTaskResponseRow(row: any): UserTaskResponse {
    return {
      id: row.id,
      enrollment_id: row.enrollment_id,
      task_id: row.task_id,
      day: row.day,
      completed: row.completed,
      completed_at: row.completed_at,
      time_spent_seconds: row.time_spent_seconds,
      response_data: row.response_data,
      quiz_score: row.quiz_score,
      quiz_passed: row.quiz_passed,
      points_awarded: row.points_awarded,
    };
  }

  private mapHabitRow(row: any): HabitLoop {
    return {
      id: row.id,
      user_id: row.user_id,
      habit_name: row.habit_name,
      cue: row.cue,
      routine: row.routine,
      reward: row.reward,
      frequency: row.frequency,
      custom_days: row.custom_days,
      target_time: row.target_time,
      current_streak: row.current_streak,
      longest_streak: row.longest_streak,
      total_completions: row.total_completions,
      completion_rate: parseFloat(row.completion_rate || 0),
      level: row.level,
      points_per_completion: row.points_per_completion,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  private mapHabitCompletionRow(row: any): HabitCompletion {
    return {
      id: row.id,
      habit_id: row.habit_id,
      user_id: row.user_id,
      completed_at: row.completed_at,
      notes: row.notes,
      mood_rating: row.mood_rating,
      points_awarded: row.points_awarded,
    };
  }
}

export default ProgramsDB;
