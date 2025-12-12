import { Router, Request, Response } from "express";
import axios from "axios";
import FormData from "form-data";

export const bodyScanRouter = Router();

const RAW_BODY_SCAN_SERVICE_BASE = process.env.BODY_SCAN_SERVICE_BASE || "";
const BODY_SCAN_SERVICE_BASE = RAW_BODY_SCAN_SERVICE_BASE.replace(/\/+$/g, "");

// IMPORTANT FIX:
// This router is mounted at: app.use("/api/v1/body-scan", bodyScanUpload, bodyScanRouter)
// Therefore the path here must be RELATIVE ("/"), not "/api/v1/body-scan".
bodyScanRouter.post("/", async (req: Request, res: Response) => {
  try {
    if (!BODY_SCAN_SERVICE_BASE) {
      console.error("[BodyScan] BODY_SCAN_SERVICE_BASE env var is missing.");
      return res.status(500).json({
        ok: false,
        error: "Body scan service is not configured",
      });
    }

    const files = (req as any).files || {};

    // Pull user id from query OR body (camelCase or snake_case)
    const qUserId =
      typeof req.query.userId === "string" ? req.query.userId : undefined;

    const bodyUserIdCamel =
      typeof (req as any).body?.userId === "string"
        ? (req as any).body.userId
        : undefined;

    const bodyUserIdSnake =
      typeof (req as any).body?.user_id === "string"
        ? (req as any).body.user_id
        : undefined;

    const userId = bodyUserIdSnake || bodyUserIdCamel || qUserId || "anonymous";

    // Validate required images
    if (!files.front || !files.side || !files.back) {
      console.warn("[BodyScan] Missing required image fields in req.files");
      return res.status(400).json({
        ok: false,
        error:
          "Missing required images. Must include 'front', 'side', and 'back' fields.",
      });
    }

    const form = new FormData();

    // Python expects this exact field name:
    form.append("user_id", userId);

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
    console.log("[BodyScan] Forwarding request to:", pythonUrl);

    const resp = await axios.post(pythonUrl, form, {
      headers: form.getHeaders(),
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout: 90_000,
    });

    return res.status(200).json({
      ok: true,
      ...resp.data,
    });
  } catch (err: any) {
    console.error("[BodyScan] Error calling Python service:", {
      message: err?.message,
      code: err?.code,
      status: err?.response?.status,
      data: err?.response?.data,
    });

    const status = err?.response?.status || 500;
    const upstream = err?.response?.data;

    let errorMessage = "Body scan failed at proxy step";

    if (upstream) {
      if (typeof upstream === "string") {
        errorMessage = `Body scan failed: ${upstream}`;
      } else if (typeof upstream === "object") {
        if (typeof upstream.error === "string") {
          errorMessage = upstream.error;
        } else if (typeof upstream.detail === "string") {
          errorMessage = upstream.detail;
        }
      }
    } else if (err?.message) {
      errorMessage = `Body scan failed: ${err.message}`;
    }

    return res.status(status).json({
      ok: false,
      error: errorMessage,
    });
  }
});
