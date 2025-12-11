import { Router, Request, Response } from "express";
import axios from "axios";
import FormData from "form-data";

export const bodyScanRouter = Router();

const BODY_SCAN_SERVICE_BASE =
  process.env.BODY_SCAN_SERVICE_BASE ||
  "https://heirclark-body-scan-service.up.railway.app";

bodyScanRouter.post(
  "/api/v1/body-scan",
  async (req: Request, res: Response) => {
    try {
      // expecting multipart/form-data with fields:
      // userId, front, side, back
      const userId = (req.body.userId as string) || "anonymous";

      const files = (req as any).files || {}; // depending on your multer config

      const form = new FormData();
      form.append("user_id", userId);

      if (!files.front || !files.side || !files.back) {
        return res.status(400).json({
          error:
            "Missing required images. Need front, side, and back photos.",
        });
      }

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

      const url = `${BODY_SCAN_SERVICE_BASE}/api/v1/body-scan`;

      const resp = await axios.post(url, form, {
        headers: form.getHeaders(),
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      });

      // Just proxy the body directly back to your frontend
      return res.status(200).json(resp.data);
    } catch (err: any) {
      console.error("[BodyScan] error:", err?.message || err);
      const status = err?.response?.status || 500;
      const data = err?.response?.data || { error: "Body scan failed" };
      return res.status(status).json(data);
    }
  }
);
