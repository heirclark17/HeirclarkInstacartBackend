import express from "express";
import cors, { CorsOptions } from "cors";

const app = express();
app.use(express.json());

const allowed = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

const corsOptions: CorsOptions = {
  origin: (
    origin: string | undefined,
    callback: (err: Error | null, allow?: boolean) => void
  ) => {
    if (!origin || allowed.length === 0 || allowed.includes(origin)) {
      return callback(null, true);
    }
    return callback(null, false);
  }
};

app.use(cors(corsOptions));

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.post("/api/instacart/build-list", (req, res) => {
  res.json({ ok: true, received: req.body || {}, checkoutUrl: null });
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () =>
  console.log(`✅ Heirclark Instacart Backend running on port ${port}`)
);
