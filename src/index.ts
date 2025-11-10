import express from "express";
import crypto from "crypto";
const app = express();
app.use(express.json());

// verify Shopify app proxy signature
function verifyAppProxy(req, res, next) {
  const secret = process.env.SHOPIFY_API_SECRET!;
  const q = { ...req.query };
  const sig = String(q.signature || "");
  delete q.signature;

  const ordered = Object.keys(q).sort().map(k => {
    const v = q[k];
    return `${k}=${Array.isArray(v) ? v.join(",") : (v ?? "").toString()}`;
  }).join("");

  const hmac = crypto.createHmac("sha256", secret).update(ordered, "utf8").digest("hex");
  if (sig !== hmac) return res.status(401).send("Bad signature");
  next();
}

app.get("/proxy/build-list", verifyAppProxy, (req, res) => {
  if (req.query.ping) return res.json({ ok: true });
  res.status(405).json({ ok: false, error: "Use POST for build-list" });
});

app.post("/proxy/build-list", verifyAppProxy, (req, res) => {
  // create Instacart list here...
  res.json({ ok: true, message: "Instacart list created (stub)." });
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.listen(process.env.PORT || 3000, () =>
  console.log(`Heirclark Instacart backend running on port ${process.env.PORT || 3000}`)
);
