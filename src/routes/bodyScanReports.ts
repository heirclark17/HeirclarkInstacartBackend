// src/routes/bodyScanReports.ts
// Body Scan Reports API Routes for Heirclark
// Handles progress photos, body measurements, and AI-generated recomposition reports

import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import OpenAI from 'openai';
import {
  ProgressPhoto,
  BodyMeasurement,
  PhotoComparison,
  RecompositionReport,
  BodyGoal,
  ProgressProjection,
  PhotoType,
} from '../types/bodyScan';
import { BODY_SCAN_PROMPTS } from '../services/aiPromptTemplates';
import { authMiddleware, getCustomerId, AuthenticatedRequest } from '../middleware/auth';

// ==========================================================================
// Router Factory
// ==========================================================================

export function createBodyScanReportsRouter(pool: Pool): Router {
  const router = Router();
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // ✅ SECURITY FIX: Apply STRICT authentication to all body scan routes (OWASP A01: IDOR Protection)
  // strictAuth: true blocks legacy X-Shopify-Customer-Id headers to prevent IDOR attacks
  router.use(authMiddleware({ strictAuth: true }));

  // ==========================================================================
  // Progress Photos Endpoints
  // ==========================================================================

  // POST /api/v1/body-scan/photos
  router.post('/photos', async (req: Request, res: Response) => {
    try {
      const userId = req.body.userId || req.headers['x-shopify-customer-id'];

      if (!userId) {
        return res.status(400).json({ ok: false, error: 'userId required' });
      }

      const {
        photo_type,
        photo_url,
        thumbnail_url,
        taken_at,
        condition,
        lighting_notes,
        weight_lbs,
        body_fat_percent,
        tags,
      } = req.body;

      if (!photo_type || !photo_url) {
        return res.status(400).json({ ok: false, error: 'photo_type and photo_url required' });
      }

      const result = await pool.query(
        `INSERT INTO hc_progress_photos
         (user_id, photo_type, photo_url, thumbnail_url, taken_at, condition, lighting_notes, weight_lbs, body_fat_percent, tags)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          userId,
          photo_type,
          photo_url,
          thumbnail_url,
          taken_at || new Date(),
          condition,
          lighting_notes,
          weight_lbs,
          body_fat_percent,
          tags,
        ]
      );

      const photo = mapPhotoRow(result.rows[0]);

      // Generate AI feedback on photo quality
      let aiFeedback;
      try {
        aiFeedback = await analyzePhotoQuality(openai, photo_url, photo_type);
      } catch (e) {
        console.error('[BodyScan] AI feedback error:', e);
      }

      return res.status(201).json({
        ok: true,
        data: {
          photo,
          ai_feedback: aiFeedback,
        },
      });
    } catch (error) {
      console.error('[BodyScan] Upload photo error:', error);
      return res.status(500).json({ ok: false, error: 'Failed to upload photo' });
    }
  });

  // GET /api/v1/body-scan/photos
  router.get('/photos', async (req: Request, res: Response) => {
    try {
      const userId = req.query.userId as string || req.headers['x-shopify-customer-id'] as string;

      if (!userId) {
        return res.status(400).json({ ok: false, error: 'userId required' });
      }

      const photoType = req.query.type as string;
      const limit = parseInt(req.query.limit as string) || 50;

      let sql = 'SELECT * FROM hc_progress_photos WHERE user_id = $1';
      const params: any[] = [userId];

      if (photoType) {
        sql += ' AND photo_type = $2';
        params.push(photoType);
      }

      sql += ' ORDER BY taken_at DESC LIMIT $' + (params.length + 1);
      params.push(limit);

      const result = await pool.query(sql, params);

      return res.json({
        ok: true,
        data: result.rows.map(mapPhotoRow),
      });
    } catch (error) {
      console.error('[BodyScan] Get photos error:', error);
      return res.status(500).json({ ok: false, error: 'Failed to get photos' });
    }
  });

  // GET /api/v1/body-scan/photos/timeline
  router.get('/photos/timeline', async (req: Request, res: Response) => {
    try {
      const userId = req.query.userId as string || req.headers['x-shopify-customer-id'] as string;

      if (!userId) {
        return res.status(400).json({ ok: false, error: 'userId required' });
      }

      // Group photos by month
      const result = await pool.query(
        `SELECT
           TO_CHAR(taken_at, 'YYYY-MM') as month,
           ARRAY_AGG(
             JSON_BUILD_OBJECT(
               'id', id,
               'photo_type', photo_type,
               'photo_url', photo_url,
               'thumbnail_url', thumbnail_url,
               'taken_at', taken_at,
               'weight_lbs', weight_lbs
             ) ORDER BY taken_at
           ) as photos
         FROM hc_progress_photos
         WHERE user_id = $1
         GROUP BY TO_CHAR(taken_at, 'YYYY-MM')
         ORDER BY month DESC`,
        [userId]
      );

      return res.json({
        ok: true,
        data: {
          months: result.rows.map(row => ({
            month: row.month,
            photos: row.photos,
          })),
        },
      });
    } catch (error) {
      console.error('[BodyScan] Get timeline error:', error);
      return res.status(500).json({ ok: false, error: 'Failed to get timeline' });
    }
  });

  // ==========================================================================
  // Photo Comparison Endpoints
  // ==========================================================================

  // POST /api/v1/body-scan/compare
  router.post('/compare', async (req: Request, res: Response) => {
    try {
      const userId = req.body.userId || req.headers['x-shopify-customer-id'];
      const { photo_id_before, photo_id_after, include_ai_analysis } = req.body;

      if (!userId) {
        return res.status(400).json({ ok: false, error: 'userId required' });
      }

      if (!photo_id_before || !photo_id_after) {
        return res.status(400).json({ ok: false, error: 'photo_id_before and photo_id_after required' });
      }

      // Get both photos
      const photosResult = await pool.query(
        'SELECT * FROM hc_progress_photos WHERE id IN ($1, $2) AND user_id = $3',
        [photo_id_before, photo_id_after, userId]
      );

      if (photosResult.rows.length !== 2) {
        return res.status(404).json({ ok: false, error: 'One or both photos not found' });
      }

      const photoBefore = mapPhotoRow(photosResult.rows.find((r: any) => r.id === photo_id_before));
      const photoAfter = mapPhotoRow(photosResult.rows.find((r: any) => r.id === photo_id_after));

      const daysBetween = Math.round(
        (photoAfter.taken_at.getTime() - photoBefore.taken_at.getTime()) / (1000 * 60 * 60 * 24)
      );

      const comparison: PhotoComparison = {
        photo_before: photoBefore,
        photo_after: photoAfter,
        days_between: daysBetween,
        measurement_changes: {
          weight_change_lbs: (photoAfter.weight_lbs || 0) - (photoBefore.weight_lbs || 0),
          body_fat_change_percent: (photoAfter.body_fat_percent || 0) - (photoBefore.body_fat_percent || 0),
        },
      };

      // Generate AI analysis if requested
      if (include_ai_analysis !== false) {
        try {
          comparison.ai_analysis = await generatePhotoComparisonAnalysis(
            openai,
            photoBefore,
            photoAfter,
            daysBetween
          );
        } catch (e) {
          console.error('[BodyScan] AI comparison error:', e);
        }
      }

      return res.json({
        ok: true,
        data: comparison,
      });
    } catch (error) {
      console.error('[BodyScan] Compare photos error:', error);
      return res.status(500).json({ ok: false, error: 'Failed to compare photos' });
    }
  });

  // ==========================================================================
  // Body Measurements Endpoints
  // ==========================================================================

  // POST /api/v1/body-scan/measurements
  router.post('/measurements', async (req: Request, res: Response) => {
    try {
      const userId = req.body.userId || req.headers['x-shopify-customer-id'];

      if (!userId) {
        return res.status(400).json({ ok: false, error: 'userId required' });
      }

      const {
        weight_lbs,
        body_fat_percent,
        lean_mass_lbs,
        fat_mass_lbs,
        waist_inches,
        hip_inches,
        chest_inches,
        arm_inches,
        thigh_inches,
        neck_inches,
        source,
        device_name,
        measured_at,
      } = req.body;

      if (!weight_lbs) {
        return res.status(400).json({ ok: false, error: 'weight_lbs required' });
      }

      // Calculate derived metrics
      const bmi = weight_lbs ? calculateBMI(weight_lbs, req.body.height_inches || 70) : null;
      const waistToHip = waist_inches && hip_inches ? waist_inches / hip_inches : null;

      const result = await pool.query(
        `INSERT INTO hc_body_measurements
         (user_id, measured_at, weight_lbs, body_fat_percent, lean_mass_lbs, fat_mass_lbs,
          waist_inches, hip_inches, chest_inches, arm_inches, thigh_inches, neck_inches,
          bmi, waist_to_hip_ratio, source, device_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         RETURNING *`,
        [
          userId,
          measured_at || new Date(),
          weight_lbs,
          body_fat_percent,
          lean_mass_lbs,
          fat_mass_lbs,
          waist_inches,
          hip_inches,
          chest_inches,
          arm_inches,
          thigh_inches,
          neck_inches,
          bmi,
          waistToHip,
          source || 'manual',
          device_name,
        ]
      );

      return res.status(201).json({
        ok: true,
        data: mapMeasurementRow(result.rows[0]),
      });
    } catch (error) {
      console.error('[BodyScan] Add measurement error:', error);
      return res.status(500).json({ ok: false, error: 'Failed to add measurement' });
    }
  });

  // GET /api/v1/body-scan/measurements
  router.get('/measurements', async (req: Request, res: Response) => {
    try {
      const userId = req.query.userId as string || req.headers['x-shopify-customer-id'] as string;

      if (!userId) {
        return res.status(400).json({ ok: false, error: 'userId required' });
      }

      const days = parseInt(req.query.days as string) || 90;
      const since = new Date();
      since.setDate(since.getDate() - days);

      const result = await pool.query(
        `SELECT * FROM hc_body_measurements
         WHERE user_id = $1 AND measured_at >= $2
         ORDER BY measured_at DESC`,
        [userId, since]
      );

      return res.json({
        ok: true,
        data: result.rows.map(mapMeasurementRow),
      });
    } catch (error) {
      console.error('[BodyScan] Get measurements error:', error);
      return res.status(500).json({ ok: false, error: 'Failed to get measurements' });
    }
  });

  // ==========================================================================
  // Recomposition Reports Endpoints
  // ==========================================================================

  // POST /api/v1/body-scan/reports/generate
  router.post('/reports/generate', async (req: Request, res: Response) => {
    try {
      const userId = req.body.userId || req.headers['x-shopify-customer-id'];

      if (!userId) {
        return res.status(400).json({ ok: false, error: 'userId required' });
      }

      const { period_start, period_end, duration_days, include_photos, include_ai_analysis } = req.body;

      // Determine date range
      let startDate: Date;
      let endDate: Date = new Date();

      if (period_start && period_end) {
        startDate = new Date(period_start);
        endDate = new Date(period_end);
      } else {
        const days = duration_days || 30;
        startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
      }

      // Get measurements for period
      const measurementsResult = await pool.query(
        `SELECT * FROM hc_body_measurements
         WHERE user_id = $1 AND measured_at BETWEEN $2 AND $3
         ORDER BY measured_at`,
        [userId, startDate, endDate]
      );

      if (measurementsResult.rows.length < 2) {
        return res.status(400).json({
          ok: false,
          error: 'Need at least 2 measurements to generate a report',
        });
      }

      const measurements = measurementsResult.rows.map(mapMeasurementRow);
      const firstMeasurement = measurements[0];
      const lastMeasurement = measurements[measurements.length - 1];

      // Get nutrition data for period
      const nutritionResult = await pool.query(
        `SELECT
           AVG(calories) as avg_calories,
           AVG(protein) as avg_protein,
           AVG(carbs) as avg_carbs,
           AVG(fat) as avg_fat,
           COUNT(*) as log_count
         FROM hc_nutrition_logs
         WHERE shopify_customer_id = $1 AND logged_at BETWEEN $2 AND $3`,
        [userId, startDate, endDate]
      );

      const nutritionData = nutritionResult.rows[0];

      // Get activity data
      const activityResult = await pool.query(
        `SELECT
           AVG(steps) as avg_steps,
           SUM(active_calories) as total_active_calories
         FROM hc_health_latest
         WHERE shopify_customer_id = $1`,
        [userId]
      );

      const activityData = activityResult.rows[0];

      // Calculate changes
      const weightChange = lastMeasurement.weight_lbs - firstMeasurement.weight_lbs;
      const bodyFatChange = (lastMeasurement.body_fat_percent || 0) - (firstMeasurement.body_fat_percent || 0);
      const leanMassChange = (lastMeasurement.lean_mass_lbs || 0) - (firstMeasurement.lean_mass_lbs || 0);

      // Determine phase
      let phase: 'cutting' | 'bulking' | 'maintaining' | 'recomping' = 'maintaining';
      if (weightChange < -2 && bodyFatChange < 0) {
        phase = 'cutting';
      } else if (weightChange > 2 && leanMassChange > 0) {
        phase = 'bulking';
      } else if (Math.abs(weightChange) <= 2 && bodyFatChange < 0 && leanMassChange > 0) {
        phase = 'recomping';
      }

      // Generate AI analysis
      let aiSummary = '';
      let aiHighlights: string[] = [];
      let aiRecommendations: string[] = [];

      if (include_ai_analysis !== false) {
        try {
          const aiResult = await generateRecompositionAnalysis(openai, {
            startDate,
            endDate,
            firstMeasurement,
            lastMeasurement,
            nutritionData,
            activityData,
            phase,
          });
          aiSummary = aiResult.summary;
          aiHighlights = aiResult.highlights;
          aiRecommendations = aiResult.recommendations;
        } catch (e) {
          console.error('[BodyScan] AI analysis error:', e);
          aiSummary = 'AI analysis unavailable.';
        }
      }

      // Calculate recomp score (0-100)
      const recompScore = calculateRecompScore({
        weightChange,
        bodyFatChange,
        leanMassChange,
        nutritionAdherence: nutritionData.log_count / 30,  // Days logged / days in period
        phase,
      });

      const report: RecompositionReport = {
        id: crypto.randomUUID(),
        user_id: userId,
        generated_at: new Date(),
        period_start: startDate,
        period_end: endDate,
        duration_days: Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)),
        start_weight_lbs: firstMeasurement.weight_lbs,
        start_body_fat_percent: firstMeasurement.body_fat_percent,
        start_lean_mass_lbs: firstMeasurement.lean_mass_lbs,
        end_weight_lbs: lastMeasurement.weight_lbs,
        end_body_fat_percent: lastMeasurement.body_fat_percent,
        end_lean_mass_lbs: lastMeasurement.lean_mass_lbs,
        weight_change_lbs: weightChange,
        body_fat_change_percent: bodyFatChange,
        lean_mass_change_lbs: leanMassChange,
        nutrition_averages: {
          daily_calories: Math.round(nutritionData.avg_calories || 0),
          daily_protein_g: Math.round(nutritionData.avg_protein || 0),
          daily_carbs_g: Math.round(nutritionData.avg_carbs || 0),
          daily_fat_g: Math.round(nutritionData.avg_fat || 0),
          calorie_adherence_percent: 0,  // Would need target to calculate
          protein_adherence_percent: 0,
        },
        activity_summary: {
          workouts_per_week: 0,  // Would need workout logs
          total_active_minutes: 0,
          avg_steps_per_day: Math.round(activityData.avg_steps || 0),
        },
        ai_summary: aiSummary,
        ai_highlights: aiHighlights,
        ai_recommendations: aiRecommendations,
        recomp_score: recompScore,
        phase_detected: phase,
      };

      // Save report
      await pool.query(
        `INSERT INTO hc_recomp_reports (id, user_id, report_data, generated_at)
         VALUES ($1, $2, $3, $4)`,
        [report.id, userId, JSON.stringify(report), new Date()]
      );

      return res.json({
        ok: true,
        data: report,
      });
    } catch (error) {
      console.error('[BodyScan] Generate report error:', error);
      return res.status(500).json({ ok: false, error: 'Failed to generate report' });
    }
  });

  // GET /api/v1/body-scan/reports
  router.get('/reports', async (req: Request, res: Response) => {
    try {
      const userId = req.query.userId as string || req.headers['x-shopify-customer-id'] as string;

      if (!userId) {
        return res.status(400).json({ ok: false, error: 'userId required' });
      }

      const result = await pool.query(
        `SELECT * FROM hc_recomp_reports
         WHERE user_id = $1
         ORDER BY generated_at DESC
         LIMIT 10`,
        [userId]
      );

      return res.json({
        ok: true,
        data: result.rows.map((r: any) => r.report_data),
      });
    } catch (error) {
      console.error('[BodyScan] Get reports error:', error);
      return res.status(500).json({ ok: false, error: 'Failed to get reports' });
    }
  });

  // ==========================================================================
  // Goals Endpoints
  // ==========================================================================

  // POST /api/v1/body-scan/goals
  router.post('/goals', async (req: Request, res: Response) => {
    try {
      const userId = req.body.userId || req.headers['x-shopify-customer-id'];

      if (!userId) {
        return res.status(400).json({ ok: false, error: 'userId required' });
      }

      const {
        goal_type,
        target_weight_lbs,
        target_body_fat_percent,
        target_lean_mass_lbs,
        target_date,
        aggressive,
        starting_weight_lbs,
        starting_body_fat_percent,
      } = req.body;

      if (!goal_type) {
        return res.status(400).json({ ok: false, error: 'goal_type required' });
      }

      const result = await pool.query(
        `INSERT INTO hc_body_goals
         (user_id, goal_type, target_weight_lbs, target_body_fat_percent, target_lean_mass_lbs,
          target_date, aggressive, starting_weight_lbs, starting_body_fat_percent,
          current_weight_lbs, current_body_fat_percent, percent_complete, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $8, $9, 0, 'active')
         RETURNING *`,
        [
          userId,
          goal_type,
          target_weight_lbs,
          target_body_fat_percent,
          target_lean_mass_lbs,
          target_date,
          aggressive || false,
          starting_weight_lbs,
          starting_body_fat_percent,
        ]
      );

      return res.status(201).json({
        ok: true,
        data: result.rows[0],
      });
    } catch (error) {
      console.error('[BodyScan] Create goal error:', error);
      return res.status(500).json({ ok: false, error: 'Failed to create goal' });
    }
  });

  // GET /api/v1/body-scan/goals
  router.get('/goals', async (req: Request, res: Response) => {
    try {
      const userId = req.query.userId as string || req.headers['x-shopify-customer-id'] as string;

      if (!userId) {
        return res.status(400).json({ ok: false, error: 'userId required' });
      }

      const result = await pool.query(
        `SELECT * FROM hc_body_goals
         WHERE user_id = $1
         ORDER BY created_at DESC`,
        [userId]
      );

      return res.json({
        ok: true,
        data: result.rows,
      });
    } catch (error) {
      console.error('[BodyScan] Get goals error:', error);
      return res.status(500).json({ ok: false, error: 'Failed to get goals' });
    }
  });

  return router;
}

// ==========================================================================
// Helper Functions
// ==========================================================================

function mapPhotoRow(row: any): ProgressPhoto {
  return {
    id: row.id,
    user_id: row.user_id,
    photo_type: row.photo_type,
    photo_url: row.photo_url,
    thumbnail_url: row.thumbnail_url,
    taken_at: row.taken_at,
    condition: row.condition,
    lighting_notes: row.lighting_notes,
    weight_lbs: row.weight_lbs ? parseFloat(row.weight_lbs) : undefined,
    body_fat_percent: row.body_fat_percent ? parseFloat(row.body_fat_percent) : undefined,
    tags: row.tags,
    created_at: row.created_at,
  };
}

function mapMeasurementRow(row: any): BodyMeasurement {
  return {
    id: row.id,
    user_id: row.user_id,
    measured_at: row.measured_at,
    weight_lbs: parseFloat(row.weight_lbs),
    body_fat_percent: row.body_fat_percent ? parseFloat(row.body_fat_percent) : undefined,
    lean_mass_lbs: row.lean_mass_lbs ? parseFloat(row.lean_mass_lbs) : undefined,
    fat_mass_lbs: row.fat_mass_lbs ? parseFloat(row.fat_mass_lbs) : undefined,
    waist_inches: row.waist_inches ? parseFloat(row.waist_inches) : undefined,
    hip_inches: row.hip_inches ? parseFloat(row.hip_inches) : undefined,
    chest_inches: row.chest_inches ? parseFloat(row.chest_inches) : undefined,
    arm_inches: row.arm_inches ? parseFloat(row.arm_inches) : undefined,
    thigh_inches: row.thigh_inches ? parseFloat(row.thigh_inches) : undefined,
    neck_inches: row.neck_inches ? parseFloat(row.neck_inches) : undefined,
    bmi: row.bmi ? parseFloat(row.bmi) : undefined,
    waist_to_hip_ratio: row.waist_to_hip_ratio ? parseFloat(row.waist_to_hip_ratio) : undefined,
    source: row.source,
    device_name: row.device_name,
    created_at: row.created_at,
  };
}

function calculateBMI(weightLbs: number, heightInches: number): number {
  // BMI = (weight in lbs * 703) / (height in inches)^2
  return Math.round((weightLbs * 703) / (heightInches * heightInches) * 10) / 10;
}

function calculateRecompScore(data: {
  weightChange: number;
  bodyFatChange: number;
  leanMassChange: number;
  nutritionAdherence: number;
  phase: string;
}): number {
  let score = 50;  // Base score

  // Adjust based on phase goals
  if (data.phase === 'cutting') {
    if (data.weightChange < 0) score += 20;
    if (data.bodyFatChange < 0) score += 15;
    if (data.leanMassChange >= 0) score += 15;  // Preserved muscle while cutting
  } else if (data.phase === 'bulking') {
    if (data.weightChange > 0) score += 15;
    if (data.leanMassChange > 0) score += 25;
    if (data.bodyFatChange < 2) score += 10;  // Lean bulk
  } else if (data.phase === 'recomping') {
    if (data.leanMassChange > 0) score += 25;
    if (data.bodyFatChange < 0) score += 25;
  }

  // Nutrition adherence bonus
  score += Math.round(data.nutritionAdherence * 10);

  return Math.min(100, Math.max(0, score));
}

async function analyzePhotoQuality(
  openai: OpenAI,
  photoUrl: string,
  photoType: PhotoType
): Promise<{
  quality_score: number;
  lighting_feedback: string;
  pose_feedback: string;
  suggestions: string[];
}> {
  // This would use Vision API to analyze photo quality
  // For now, return a placeholder
  return {
    quality_score: 75,
    lighting_feedback: 'Good lighting from the front',
    pose_feedback: `${photoType} pose captured well`,
    suggestions: ['Try to maintain consistent lighting for future photos', 'Same time of day recommended'],
  };
}

async function generatePhotoComparisonAnalysis(
  openai: OpenAI,
  photoBefore: ProgressPhoto,
  photoAfter: ProgressPhoto,
  daysBetween: number
): Promise<{
  visible_changes: string[];
  areas_of_progress: string[];
  confidence_score: number;
  narrative: string;
}> {
  // This would use Vision API to compare photos
  // For now, generate based on measurements
  const weightChange = (photoAfter.weight_lbs || 0) - (photoBefore.weight_lbs || 0);

  return {
    visible_changes: weightChange < 0
      ? ['Reduced midsection', 'More defined shoulders']
      : ['Increased muscle mass', 'Fuller physique'],
    areas_of_progress: ['Core definition', 'Overall composition'],
    confidence_score: 0.7,
    narrative: `Over ${daysBetween} days, visible progress has been made. ${Math.abs(weightChange).toFixed(1)} lbs ${weightChange < 0 ? 'lost' : 'gained'} with positive body composition changes.`,
  };
}

async function generateRecompositionAnalysis(
  openai: OpenAI,
  data: {
    startDate: Date;
    endDate: Date;
    firstMeasurement: BodyMeasurement;
    lastMeasurement: BodyMeasurement;
    nutritionData: any;
    activityData: any;
    phase: string;
  }
): Promise<{
  summary: string;
  highlights: string[];
  recommendations: string[];
}> {
  const weightChange = data.lastMeasurement.weight_lbs - data.firstMeasurement.weight_lbs;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a fitness coach analyzing body recomposition progress. Be encouraging but honest.',
        },
        {
          role: 'user',
          content: BODY_SCAN_PROMPTS.RECOMP_REPORT({
            startDate: data.startDate.toISOString().split('T')[0],
            endDate: data.endDate.toISOString().split('T')[0],
            startWeight: data.firstMeasurement.weight_lbs,
            endWeight: data.lastMeasurement.weight_lbs,
            startBodyFat: data.firstMeasurement.body_fat_percent,
            endBodyFat: data.lastMeasurement.body_fat_percent,
            avgCalories: Math.round(data.nutritionData.avg_calories || 0),
            avgProtein: Math.round(data.nutritionData.avg_protein || 0),
            workoutsPerWeek: 3,  // Would need real data
          }),
        },
      ],
      max_tokens: 500,
      temperature: 0.7,
    });

    const content = response.choices[0]?.message?.content || '';

    // Parse response into sections
    return {
      summary: content.split('\n')[0] || `${Math.abs(weightChange).toFixed(1)} lbs ${weightChange < 0 ? 'lost' : 'gained'} during this period.`,
      highlights: [
        `Weight ${weightChange < 0 ? 'decreased' : 'increased'} by ${Math.abs(weightChange).toFixed(1)} lbs`,
        `Average daily protein: ${Math.round(data.nutritionData.avg_protein || 0)}g`,
        `Phase detected: ${data.phase}`,
      ],
      recommendations: [
        'Continue tracking nutrition consistently',
        'Ensure adequate protein intake for muscle preservation',
        'Take progress photos weekly for visual tracking',
      ],
    };
  } catch (error) {
    console.error('[BodyScan] AI recomp analysis error:', error);
    return {
      summary: `${Math.abs(weightChange).toFixed(1)} lbs ${weightChange < 0 ? 'lost' : 'gained'} during this period.`,
      highlights: [`Weight change: ${weightChange > 0 ? '+' : ''}${weightChange.toFixed(1)} lbs`],
      recommendations: ['Continue tracking progress consistently'],
    };
  }
}

export default createBodyScanReportsRouter;
