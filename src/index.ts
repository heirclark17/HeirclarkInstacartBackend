import express from "express";
import cors from "cors";

const app = express();
app.use(express.json());

// Allow store CORS
const allowed = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || allowed.length === 0 || allowed.includes(origin)) return cb(null, true);
      return cb(null, false);
    }
  })
);

// Health check
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// Instacart list builder placeholder
app.post("/api/instacart/build-list", (req, res) => {
  res.json({
    ok: true,
    received: req.body || {},
    checkoutUrl: null
  });
});

// Railway provides the PORT automatically
const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`✅ Heirclark Instacart Backend running on port ${port}`));
