import { Router } from "express";
import { z } from "zod";
import { v4 as uuid } from "uuid";
import { pool } from "../db/pool";

export const progressPhotosRouter = Router();

// Schema for creating a progress photo
const createPhotoSchema = z.object({
  imageUrl: z.string().url(),
  weight: z.number().positive().optional(),
  notes: z.string().max(500).optional(),
  photoType: z.enum(["front", "side", "back", "other"]).default("front"),
});

// POST /api/v1/progress-photos - Upload a progress photo
progressPhotosRouter.post("/", async (req, res, next) => {
  try {
    const customerId = req.headers["x-shopify-customer-id"] as string;
    if (!customerId) {
      return res.status(401).json({ error: "Missing customer ID" });
    }

    const parsed = createPhotoSchema.parse(req.body);

    const result = await pool.query(`
      INSERT INTO hc_progress_photos (
        id, shopify_customer_id, image_url, weight_lbs, notes, photo_type
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [
      uuid(),
      customerId,
      parsed.imageUrl,
      parsed.weight || null,
      parsed.notes || null,
      parsed.photoType,
    ]);

    res.status(201).json({
      success: true,
      photo: formatPhoto(result.rows[0]),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/progress-photos - Get all progress photos for a user
progressPhotosRouter.get("/", async (req, res, next) => {
  try {
    const customerId = req.headers["x-shopify-customer-id"] as string;
    if (!customerId) {
      return res.status(401).json({ error: "Missing customer ID" });
    }

    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const photoType = req.query.type as string;

    let query = `
      SELECT * FROM hc_progress_photos
      WHERE shopify_customer_id = $1
    `;
    const params: any[] = [customerId];

    if (photoType) {
      query += ` AND photo_type = $2`;
      params.push(photoType);
    }

    query += ` ORDER BY taken_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await pool.query(query, params);

    res.json({
      photos: result.rows.map(formatPhoto),
      count: result.rows.length,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/progress-photos/compare - Get two photos for comparison
progressPhotosRouter.get("/compare", async (req, res, next) => {
  try {
    const customerId = req.headers["x-shopify-customer-id"] as string;
    if (!customerId) {
      return res.status(401).json({ error: "Missing customer ID" });
    }

    const photoType = (req.query.type as string) || "front";

    // Get first and most recent photo of the same type
    const result = await pool.query(`
      (
        SELECT * FROM hc_progress_photos
        WHERE shopify_customer_id = $1 AND photo_type = $2
        ORDER BY taken_at ASC
        LIMIT 1
      )
      UNION ALL
      (
        SELECT * FROM hc_progress_photos
        WHERE shopify_customer_id = $1 AND photo_type = $2
        ORDER BY taken_at DESC
        LIMIT 1
      )
    `, [customerId, photoType]);

    if (result.rows.length < 2) {
      return res.json({
        comparison: null,
        message: "Need at least 2 photos for comparison",
      });
    }

    const before = formatPhoto(result.rows[0]);
    const after = formatPhoto(result.rows[1]);

    // Calculate weight change if both have weights
    let weightChange = null;
    if (before.weight && after.weight) {
      weightChange = {
        difference: after.weight - before.weight,
        percentage: ((after.weight - before.weight) / before.weight * 100).toFixed(1),
      };
    }

    // Calculate days between photos
    const daysBetween = Math.floor(
      (new Date(after.takenAt).getTime() - new Date(before.takenAt).getTime()) / (1000 * 60 * 60 * 24)
    );

    res.json({
      comparison: {
        before,
        after,
        daysBetween,
        weightChange,
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/progress-photos/timeline - Get photos grouped by month
progressPhotosRouter.get("/timeline", async (req, res, next) => {
  try {
    const customerId = req.headers["x-shopify-customer-id"] as string;
    if (!customerId) {
      return res.status(401).json({ error: "Missing customer ID" });
    }

    const result = await pool.query(`
      SELECT
        to_char(taken_at, 'YYYY-MM') as month,
        json_agg(
          json_build_object(
            'id', id,
            'imageUrl', image_url,
            'weight', weight_lbs,
            'notes', notes,
            'photoType', photo_type,
            'takenAt', taken_at
          ) ORDER BY taken_at DESC
        ) as photos
      FROM hc_progress_photos
      WHERE shopify_customer_id = $1
      GROUP BY to_char(taken_at, 'YYYY-MM')
      ORDER BY month DESC
      LIMIT 12
    `, [customerId]);

    res.json({
      timeline: result.rows.map(row => ({
        month: row.month,
        photos: row.photos,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/progress-photos/:id - Delete a progress photo
progressPhotosRouter.delete("/:id", async (req, res, next) => {
  try {
    const customerId = req.headers["x-shopify-customer-id"] as string;
    if (!customerId) {
      return res.status(401).json({ error: "Missing customer ID" });
    }

    const { id } = req.params;

    const result = await pool.query(`
      DELETE FROM hc_progress_photos
      WHERE id = $1 AND shopify_customer_id = $2
      RETURNING id
    `, [id, customerId]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Photo not found" });
    }

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// Helper to format photo response
function formatPhoto(row: any) {
  return {
    id: row.id,
    imageUrl: row.image_url,
    weight: row.weight_lbs,
    notes: row.notes,
    photoType: row.photo_type,
    takenAt: row.taken_at,
    createdAt: row.created_at,
  };
}
