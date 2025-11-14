// src/index.ts
import express, { Request, Response, NextFunction } from "express";
import crypto from "crypto";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Root health
app.get("/", (_req: Request, res: Response) => {
  res.status(200).json({ ok: true, service: "heirclark-backend" });
});

// OPEN GET ping for app proxy
app.get("/proxy/build-list", (req: Request, res: Response) => {
  res.status(200).json({
    ok: true,
    via: "app-proxy",
    ping: req.query.ping ?? null,
  });
});

// --- HMAC verification for App Proxy POST ---
function verifyAppProxy(req: Request, res: Response, next: NextFunction) {
  try {
    const secret = process.env.SHOPIFY_API_SECRET;
    if (!secret) {
      return res.status(500).json({ ok: false, error: "Missing SHOPIFY_API_SECRET" });
    }

    const q: Record<string, unknown> = { ...req.query };
    const sig = String(q.signature || "");
    delete (q as any).signature;

    const ordered = Object.keys(q)
      .sort()
      .map((k) =>
        `${k}=${
          Array.isArray(q[k])
            ? (q[k] as any[]).join(",")
            : (q[k] ?? "").toString()
        }`
      )
      .join("");

    const hmac = crypto.createHmac("sha256", secret).update(ordered, "utf8").digest("hex");

    if (sig !== hmac) {
      return res.status(401).json({ ok: false, error: "Bad signature" });
    }

    next();
  } catch (err) {
    console.error("verifyAppProxy error", err);
    return res.status(500).json({ ok: false, error: "verifyAppProxy crashed" });
  }
}

// POST from Shopify app proxy – stub for now
app.post("/proxy/build-list", verifyAppProxy, (req: Request, res: Response) => {
  try {
    console.log("POST /proxy/build-list body:", JSON.stringify(req.body));

    // TODO: later – call Instacart API here using the 7-day plan in req.body

    return res.status(200).json({
      ok: true,
      message: "Stubbed Instacart list generation",
      received: req.body ?? null,
    });
  } catch (err) {
    console.error("Handler error in /proxy/build-list:", err);
    return res.status(500).json({ ok: false, error: "Server error in /proxy/build-list" });
  }
});

app.listen(PORT, () => {
  console.log(`Heirclark Instacart backend listening on port ${PORT}`);
});
