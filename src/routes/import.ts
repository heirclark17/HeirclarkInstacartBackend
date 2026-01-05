// src/routes/import.ts
// Data Import API Routes for Heirclark
// Handles importing data from MyFitnessPal, LoseIt, and CSV files

import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { parse } from 'csv-parse/sync';
import {
  DataImportJob,
  ImportedFood,
  ImportSource,
  ImportStatus,
} from '../types/social';

// ==========================================================================
// SQL Schema for Import Features
// ==========================================================================

export const IMPORT_SCHEMA = `
-- Import jobs
CREATE TABLE IF NOT EXISTS hc_import_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(100) NOT NULL,
  source VARCHAR(50) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  file_url TEXT,
  file_name VARCHAR(255),
  file_size_bytes BIGINT,
  oauth_token TEXT,
  oauth_refresh_token TEXT,
  total_records INTEGER,
  imported_records INTEGER DEFAULT 0,
  failed_records INTEGER DEFAULT 0,
  error_messages TEXT[],
  import_from TIMESTAMPTZ,
  import_to TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Imported foods (mapped to our database)
CREATE TABLE IF NOT EXISTS hc_imported_foods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_job_id UUID NOT NULL REFERENCES hc_import_jobs(id) ON DELETE CASCADE,
  user_id VARCHAR(100) NOT NULL,
  original_name VARCHAR(500) NOT NULL,
  original_brand VARCHAR(255),
  original_calories INTEGER,
  original_protein_g DECIMAL(8,2),
  original_carbs_g DECIMAL(8,2),
  original_fat_g DECIMAL(8,2),
  nutrition_food_id UUID,
  mapping_confidence DECIMAL(3,2) DEFAULT 0,
  logged_at TIMESTAMPTZ,
  meal_type VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_import_jobs_user ON hc_import_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_import_jobs_status ON hc_import_jobs(status);
CREATE INDEX IF NOT EXISTS idx_imported_foods_job ON hc_imported_foods(import_job_id);
CREATE INDEX IF NOT EXISTS idx_imported_foods_user ON hc_imported_foods(user_id);
`;

// ==========================================================================
// MyFitnessPal CSV Column Mappings
// ==========================================================================

const MFP_COLUMN_MAPPINGS = {
  // Food diary export columns
  date: ['Date', 'date'],
  meal: ['Meal', 'meal', 'Meal Name'],
  food_name: ['Food Name', 'Food', 'food_name', 'Description'],
  calories: ['Calories', 'calories', 'Energy (kcal)'],
  fat: ['Fat (g)', 'fat', 'Total Fat (g)'],
  saturated_fat: ['Saturated Fat (g)', 'saturated_fat'],
  carbs: ['Carbohydrates (g)', 'carbs', 'Total Carbohydrate (g)'],
  fiber: ['Fiber (g)', 'fiber'],
  sugar: ['Sugar (g)', 'sugar', 'Sugars (g)'],
  protein: ['Protein (g)', 'protein'],
  sodium: ['Sodium (mg)', 'sodium'],
};

// ==========================================================================
// Router Factory
// ==========================================================================

// Extracted CSV import handler function
async function handleCsvImport(pool: Pool, req: Request, res: Response): Promise<Response> {
  try {
    const userId = req.body.userId || req.headers['x-shopify-customer-id'];

    if (!userId) {
      return res.status(400).json({ ok: false, error: 'userId required' });
    }

    const { source, csv_content, file_name, import_from, import_to } = req.body;

    if (!csv_content) {
      return res.status(400).json({ ok: false, error: 'csv_content required' });
    }

    // Create import job
    const jobResult = await pool.query(
      `INSERT INTO hc_import_jobs (user_id, source, file_name, import_from, import_to, status, started_at)
       VALUES ($1, $2, $3, $4, $5, 'processing', NOW())
       RETURNING *`,
      [userId, source || 'csv', file_name, import_from, import_to]
    );

    const job = jobResult.rows[0];

    try {
      // Parse CSV
      const records = parse(csv_content, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      }) as Record<string, string>[];

      // Detect source if not specified
      const detectedSource = detectCsvSource(Object.keys(records[0] || {}));

      // Process records
      let imported = 0;
      let failed = 0;
      const errors: string[] = [];

      for (const record of records) {
        try {
          const parsed = parseRecord(record, detectedSource);

          if (parsed) {
            // Check date range
            if (import_from && parsed.logged_at < new Date(import_from)) continue;
            if (import_to && parsed.logged_at > new Date(import_to)) continue;

            // Insert imported food
            await pool.query(
              `INSERT INTO hc_imported_foods
               (import_job_id, user_id, original_name, original_brand, original_calories,
                original_protein_g, original_carbs_g, original_fat_g, logged_at, meal_type)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
              [
                job.id,
                userId,
                parsed.name,
                parsed.brand,
                parsed.calories,
                parsed.protein,
                parsed.carbs,
                parsed.fat,
                parsed.logged_at,
                parsed.meal_type,
              ]
            );

            // Also create a nutrition log entry
            await pool.query(
              `INSERT INTO hc_nutrition_logs
               (shopify_customer_id, food_name, brand, calories, protein, carbs, fat, meal_type, logged_at, source)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'import')
               ON CONFLICT DO NOTHING`,
              [
                userId,
                parsed.name,
                parsed.brand,
                parsed.calories,
                parsed.protein,
                parsed.carbs,
                parsed.fat,
                parsed.meal_type,
                parsed.logged_at,
              ]
            );

            imported++;
          }
        } catch (e: any) {
          failed++;
          if (errors.length < 10) {
            errors.push(e.message);
          }
        }
      }

      // Update job status
      await pool.query(
        `UPDATE hc_import_jobs
         SET status = 'completed', total_records = $2, imported_records = $3,
             failed_records = $4, error_messages = $5, completed_at = NOW()
         WHERE id = $1`,
        [job.id, records.length, imported, failed, errors]
      );

      return res.json({
        ok: true,
        data: {
          job_id: job.id,
          status: 'completed',
          total_records: records.length,
          imported_records: imported,
          failed_records: failed,
          errors: errors.slice(0, 5),
        },
      });

    } catch (parseError: any) {
      // Mark job as failed
      await pool.query(
        `UPDATE hc_import_jobs
         SET status = 'failed', error_messages = $2, completed_at = NOW()
         WHERE id = $1`,
        [job.id, [parseError.message]]
      );

      return res.status(400).json({
        ok: false,
        error: 'Failed to parse CSV: ' + parseError.message,
      });
    }
  } catch (error) {
    console.error('[Import] CSV import error:', error);
    return res.status(500).json({ ok: false, error: 'Import failed' });
  }
}

export function createImportRouter(pool: Pool): Router {
  const router = Router();

  // ==========================================================================
  // GET /api/v1/import/sources
  // List available import sources
  // ==========================================================================
  router.get('/sources', async (req: Request, res: Response) => {
    return res.json({
      ok: true,
      data: {
        sources: [
          {
            id: 'myfitnesspal',
            name: 'MyFitnessPal',
            type: 'csv',
            instructions: 'Export your food diary from MFP settings as CSV, then upload here.',
            supported_data: ['food_diary', 'weight_logs'],
            status: 'available',
          },
          {
            id: 'loseit',
            name: 'Lose It!',
            type: 'csv',
            instructions: 'Export your data from Lose It! settings as CSV.',
            supported_data: ['food_diary', 'weight_logs'],
            status: 'available',
          },
          {
            id: 'cronometer',
            name: 'Cronometer',
            type: 'csv',
            instructions: 'Export diary from Cronometer settings.',
            supported_data: ['food_diary'],
            status: 'available',
          },
          {
            id: 'csv',
            name: 'Generic CSV',
            type: 'csv',
            instructions: 'Upload any CSV with columns: date, food_name, calories, protein, carbs, fat',
            supported_data: ['food_diary'],
            status: 'available',
          },
          {
            id: 'apple_health',
            name: 'Apple Health',
            type: 'native',
            instructions: 'Connect through the iOS app to sync Apple Health data.',
            supported_data: ['weight', 'steps', 'workouts'],
            status: 'coming_soon',
          },
        ],
      },
    });
  });

  // ==========================================================================
  // POST /api/v1/import/csv
  // Upload and import a CSV file
  // ==========================================================================
  router.post('/csv', async (req: Request, res: Response) => {
    return handleCsvImport(pool, req, res);
  });

  // ==========================================================================
  // POST /api/v1/import/myfitnesspal
  // Import from MyFitnessPal CSV export (alias for /csv with source=myfitnesspal)
  // ==========================================================================
  router.post('/myfitnesspal', async (req: Request, res: Response) => {
    // Set source and forward to CSV handler
    req.body.source = 'myfitnesspal';
    // Re-emit the request to the CSV route by calling the same handler
    return handleCsvImport(pool, req, res);
  });

  // ==========================================================================
  // GET /api/v1/import/jobs
  // List import jobs for user
  // ==========================================================================
  router.get('/jobs', async (req: Request, res: Response) => {
    try {
      const userId = req.query.userId as string || req.headers['x-shopify-customer-id'] as string;

      if (!userId) {
        return res.status(400).json({ ok: false, error: 'userId required' });
      }

      const result = await pool.query(
        `SELECT * FROM hc_import_jobs
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT 20`,
        [userId]
      );

      return res.json({
        ok: true,
        data: result.rows,
      });
    } catch (error) {
      console.error('[Import] Get jobs error:', error);
      return res.status(500).json({ ok: false, error: 'Failed to get import jobs' });
    }
  });

  // ==========================================================================
  // GET /api/v1/import/jobs/:jobId
  // Get import job details
  // ==========================================================================
  router.get('/jobs/:jobId', async (req: Request, res: Response) => {
    try {
      const userId = req.query.userId as string || req.headers['x-shopify-customer-id'] as string;
      const { jobId } = req.params;

      const jobResult = await pool.query(
        'SELECT * FROM hc_import_jobs WHERE id = $1 AND user_id = $2',
        [jobId, userId]
      );

      if (jobResult.rows.length === 0) {
        return res.status(404).json({ ok: false, error: 'Job not found' });
      }

      const job = jobResult.rows[0];

      // Get sample imported foods
      const foodsResult = await pool.query(
        `SELECT * FROM hc_imported_foods
         WHERE import_job_id = $1
         ORDER BY logged_at DESC
         LIMIT 10`,
        [jobId]
      );

      return res.json({
        ok: true,
        data: {
          job,
          sample_imports: foodsResult.rows,
        },
      });
    } catch (error) {
      console.error('[Import] Get job error:', error);
      return res.status(500).json({ ok: false, error: 'Failed to get job' });
    }
  });

  // ==========================================================================
  // DELETE /api/v1/import/jobs/:jobId
  // Delete an import job and its data
  // ==========================================================================
  router.delete('/jobs/:jobId', async (req: Request, res: Response) => {
    try {
      const userId = req.body.userId || req.headers['x-shopify-customer-id'];
      const { jobId } = req.params;

      if (!userId) {
        return res.status(400).json({ ok: false, error: 'userId required' });
      }

      // Verify ownership
      const jobResult = await pool.query(
        'SELECT * FROM hc_import_jobs WHERE id = $1 AND user_id = $2',
        [jobId, userId]
      );

      if (jobResult.rows.length === 0) {
        return res.status(404).json({ ok: false, error: 'Job not found' });
      }

      // Delete job (cascade deletes imported foods)
      await pool.query('DELETE FROM hc_import_jobs WHERE id = $1', [jobId]);

      return res.json({ ok: true, message: 'Import job deleted' });
    } catch (error) {
      console.error('[Import] Delete job error:', error);
      return res.status(500).json({ ok: false, error: 'Failed to delete job' });
    }
  });

  // ==========================================================================
  // POST /api/v1/import/rollback/:jobId
  // Rollback/undo an import
  // ==========================================================================
  router.post('/rollback/:jobId', async (req: Request, res: Response) => {
    try {
      const userId = req.body.userId || req.headers['x-shopify-customer-id'];
      const { jobId } = req.params;

      if (!userId) {
        return res.status(400).json({ ok: false, error: 'userId required' });
      }

      // Get imported foods
      const foodsResult = await pool.query(
        `SELECT logged_at, original_name FROM hc_imported_foods
         WHERE import_job_id = $1`,
        [jobId]
      );

      // Delete corresponding nutrition logs
      for (const food of foodsResult.rows) {
        await pool.query(
          `DELETE FROM hc_nutrition_logs
           WHERE shopify_customer_id = $1 AND food_name = $2 AND logged_at = $3 AND source = 'import'`,
          [userId, food.original_name, food.logged_at]
        );
      }

      // Delete imported foods
      await pool.query('DELETE FROM hc_imported_foods WHERE import_job_id = $1', [jobId]);

      // Update job status
      await pool.query(
        `UPDATE hc_import_jobs SET status = 'rolled_back' WHERE id = $1`,
        [jobId]
      );

      return res.json({
        ok: true,
        message: `Rolled back ${foodsResult.rows.length} imported entries`,
      });
    } catch (error) {
      console.error('[Import] Rollback error:', error);
      return res.status(500).json({ ok: false, error: 'Failed to rollback' });
    }
  });

  return router;
}

// ==========================================================================
// Helper Functions
// ==========================================================================

function detectCsvSource(columns: string[]): ImportSource {
  const colSet = new Set(columns.map(c => c.toLowerCase()));

  // MFP typically has these columns
  if (colSet.has('meal') && colSet.has('food name')) {
    return 'myfitnesspal';
  }

  // Lose It columns
  if (colSet.has('type') && colSet.has('name') && colSet.has('icon')) {
    return 'loseit';
  }

  // Cronometer
  if (colSet.has('food group') || colSet.has('energy (kcal)')) {
    return 'cronometer';
  }

  return 'csv';
}

function parseRecord(
  record: Record<string, string>,
  source: ImportSource
): {
  name: string;
  brand?: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  meal_type?: string;
  logged_at: Date;
} | null {
  // Normalize column names
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    normalized[key.toLowerCase().trim()] = value;
  }

  // Find values using mappings
  const getValue = (mappings: string[]): string | undefined => {
    for (const key of mappings) {
      const val = normalized[key.toLowerCase()];
      if (val !== undefined && val !== '') return val;
    }
    return undefined;
  };

  const name = getValue(MFP_COLUMN_MAPPINGS.food_name);
  if (!name) return null;

  const dateStr = getValue(MFP_COLUMN_MAPPINGS.date);
  const logged_at = dateStr ? parseDate(dateStr) : new Date();

  const calories = parseFloat(getValue(MFP_COLUMN_MAPPINGS.calories) || '0');
  const protein = parseFloat(getValue(MFP_COLUMN_MAPPINGS.protein) || '0');
  const carbs = parseFloat(getValue(MFP_COLUMN_MAPPINGS.carbs) || '0');
  const fat = parseFloat(getValue(MFP_COLUMN_MAPPINGS.fat) || '0');
  const meal_type = getValue(MFP_COLUMN_MAPPINGS.meal)?.toLowerCase();

  return {
    name,
    calories,
    protein,
    carbs,
    fat,
    meal_type,
    logged_at,
  };
}

function parseDate(dateStr: string): Date {
  // Try common formats
  const formats = [
    /^(\d{4})-(\d{2})-(\d{2})$/,  // 2024-01-15
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,  // 1/15/2024 or 01/15/2024
    /^(\d{1,2})-(\d{1,2})-(\d{4})$/,  // 1-15-2024
  ];

  for (const format of formats) {
    const match = dateStr.match(format);
    if (match) {
      // Assume YYYY-MM-DD for first format, MM/DD/YYYY for others
      if (format.source.startsWith('^(\\d{4})')) {
        return new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
      } else {
        return new Date(parseInt(match[3]), parseInt(match[1]) - 1, parseInt(match[2]));
      }
    }
  }

  // Fallback to Date.parse
  const parsed = Date.parse(dateStr);
  return isNaN(parsed) ? new Date() : new Date(parsed);
}

export default createImportRouter;
