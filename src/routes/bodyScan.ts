import { Router, Request, Response } from "express";
import axios from "axios";
import FormData from "form-data";

export const bodyScanRouter = Router();

// Base URL of your Python microservice on Railway
// Example: https://heirclark-body-scan-service-production.up.railway.app
const BODY_SCAN_SERVICE_BASE =
  process.env.BODY_SCAN_SERVICE_BASE ||
  "http://localhost:8000"; // fallback for local testing

/**
 * POST /api/v1/body-scan
 *
 * Expects multipart/form-data with fields:
 *   - user_id
 *   - front (image file)
 *   - side  (image file)
 *   - back  (image file)
 *
 * Multer already populated req.files via upload.fields() in index.ts.
 */
bodyScanRouter.post(
  "/api/v1/body-scan",
  async (req: Request, res: Response) => {
    try {
      // Ensure ENV variable is set
      if (!BODY_SCAN_SERVICE_BASE) {
        console.error("BODY_SCAN_SERVICE_BASE env var is missing.");
        return res.status(500).json({
          ok: false,
          error: "Body scan service is not configured",
        });
      }

      const files = (req as any).files || {};
      const userId = (req.body.userId as string) || "anonymous";

      // Validate required images
      if (!files.front || !files.side || !files.back) {
        return res.status(400).json({
          ok: false,
          error:
            "Missing required images. Must include 'front', 'side', and 'back' fields.",
        });
      }

      // Build form-data to send to Python service
      const form = new FormData();
      form.append("user_id", userId);

      // Append each file
      form.append("front", files.front[0].buffer, {
        filename: files.front[0].originalname || "front.jpg",
        contentType: files.front[0].mimetype || "image/jpeg",
      });

      form.append("side", files.side[0].buffer, {
        filename: files.side[0].originalname || "side.jpg",
        contentType: files.side[0].mimetype || "image/jpeg",
      });

      form.append("back", files.back[0].buffer, {
        filename: files.back[0].originalname || "back.jpg",
        contentType: files.back[0].mimetype || "image/jpeg",
      });

      const pythonUrl = `${BODY_SCAN_SERVICE_BASE}/api/v1/body-scan`;

      console.log(`[BodyScan] Forwarding request to: ${pythonUrl}`);

      // Call the Python SMPL-X microservice
      const resp = await axios.post(pythonUrl, form, {
        headers: form.getHeaders(),
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        timeout: 90000, // 90 seconds for heavy SMPL-X compute
      });

      // Forward the response straight back to Shopify
      return res.status(200).json({
        ok: true,
        ...resp.data,
      });
    } catch (err: any) {
      console.error("[BodyScan] Error calling Python service:", err?.message);

      const status = err?.response?.status || 500;
      const data = err?.response?.data || {
        ok: false,
        error: "Body scan failed at proxy step",
      };

      return res.status(status).json(data);
    }
  }
);
