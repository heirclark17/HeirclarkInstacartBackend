// src/routes/proxy.ts (or inside index.ts)
import { Request, Response } from "express";
import { BuildListPayloadSchema, BuildListPayload } from "./schema"; // ← your schema.ts
import { verifyAppProxy } from "./verify"; // if you have it split out
import axios from "axios";

const INSTACART_API_BASE = (process.env.INSTACART_API_BASE || "").replace(/\/+$/,"");
const INSTACART_API_KEY = process.env.INSTACART_API_KEY || "";
const INSTACART_KEY_HEADER = process.env.INSTACART_KEY_HEADER || "X-API-Key";

function toHttpProblem(issues: any[]) {
  return issues.map((i) => ({
    path: i.path?.join(".") ?? "",
    message: i.message
  }));
}

async function forwardToInstacart(payload: BuildListPayload) {
  if (!INSTACART_API_BASE || !INSTACART_API_KEY) {
    throw new Error("Instacart env vars are not configured");
  }
  const url = `${INSTACART_API_BASE}/lists`;
  const headers: Record<string,string> = {
    "Content-Type": "application/json",
    [INSTACART_KEY_HEADER]: INSTACART_API_KEY
  };
  const { data } = await axios.post(url, payload, { headers, timeout: 25_000 });
  return data;
}

// GET ping (optional)
app.get("/proxy/build-list", verifyAppProxy, (req: Request, res: Response) => {
  if (req.query.ping) return res.json({ ok: true });
  res.status(405).json({ ok:false, error:"Use POST for /proxy/build-list" });
});

// POST: validate with Zod, then forward
app.post("/proxy/build-list", verifyAppProxy, async (req: Request, res: Response) => {
  const parsed = BuildListPayloadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      ok: false,
      error: "Invalid payload",
      issues: toHttpProblem(parsed.error.issues)
    });
  }

  try {
    const instacartResp = await forwardToInstacart(parsed.data);
    return res.json({ ok: true, message: "Instacart list created.", instacart: instacartResp });
  } catch (err: any) {
    console.error("Instacart error:", err?.response?.data || err?.message || err);
    return res.status(502).json({
      ok: false,
      error: "Failed to create Instacart list",
      detail: err?.response?.data || err?.message || "unknown"
    });
  }
});
