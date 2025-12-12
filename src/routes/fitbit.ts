import { Router, Request, Response } from "express";
import axios from "axios";
import { pool } from "../db/pool";

const router = Router();

function getCustomerId(req: Request) {
  return req.headers["x-hc-customer-id"] as string | undefined;
}

/* -------------------------------------------
   1. CONNECT → Redirect to Fitbit
--------------------------------------------*/
router.get("/connect", (req, res) => {
  const customerId = getCustomerId(req);
  if (!customerId) {
    return res.status(401).send("Missing Shopify customer ID");
  }

  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.FITBIT_CLIENT_ID!,
    redirect_uri: process.env.FITBIT_REDIRECT_URI!,
    scope: "activity nutrition profile",
    state: customerId,
  });

  res.redirect(`https://www.fitbit.com/oauth2/authorize?${params}`);
});

/* -------------------------------------------
   2. CALLBACK → Exchange Code for Tokens
--------------------------------------------*/
router.get("/auth/callback", async (req, res) => {
  const code = req.query.code as string;
  const customerId = req.query.state as string;

  if (!code || !customerId) {
    return res.status(400).send("Invalid Fitbit callback");
  }

  try {
    const tokenResp = await axios.post(
      "https://api.fitbit.com/oauth2/token",
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: process.env.FITBIT_REDIRECT_URI!,
      }),
      {
        auth: {
          username: process.env.FITBIT_CLIENT_ID!,
          password: process.env.FITBIT_CLIENT_SECRET!,
        },
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      }
    );

    const {
      access_token,
      refresh_token,
      expires_in,
      scope,
      token_type,
    } = tokenResp.data;

    const expiresAt = new Date(Date.now() + expires_in * 1000);

    await pool.query(
      `
      INSERT INTO wearable_tokens
        (customer_id, provider, access_token, refresh_token, token_type, scope, expires_at)
      VALUES ($1, 'fitbit', $2, $3, $4, $5, $6)
      ON CONFLICT (customer_id, provider)
      DO UPDATE SET
        access_token = EXCLUDED.access_token,
        refresh_token = EXCLUDED.refresh_token,
        token_type = EXCLUDED.token_type,
        scope = EXCLUDED.scope,
        expires_at = EXCLUDED.expires_at,
        updated_at = NOW()
      `,
      [
        customerId,
        access_token,
        refresh_token,
        token_type,
        scope,
        expiresAt,
      ]
    );

    res.redirect("https://www.heirclark.com/pages/calorie-counter?fitbit=connected");
  } catch (err) {
    console.error("Fitbit callback error", err);
    res.status(500).send("Fitbit authentication failed");
  }
});

/* -------------------------------------------
   3. TOKEN HELPER (AUTO REFRESH)
--------------------------------------------*/
async function getValidFitbitToken(customerId: string): Promise<string> {
  const { rows } = await pool.query(
    `
    SELECT * FROM wearable_tokens
    WHERE customer_id = $1 AND provider = 'fitbit'
    `,
    [customerId]
  );

  if (!rows.length) {
    throw new Error("Fitbit not connected");
  }

  const token = rows[0];

  if (new Date(token.expires_at) > new Date()) {
    return token.access_token;
  }

  // Refresh token
  const refreshResp = await axios.post(
    "https://api.fitbit.com/oauth2/token",
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: token.refresh_token,
    }),
    {
      auth: {
        username: process.env.FITBIT_CLIENT_ID!,
        password: process.env.FITBIT_CLIENT_SECRET!,
      },
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    }
  );

  const {
    access_token,
    refresh_token,
    expires_in,
    scope,
    token_type,
  } = refreshResp.data;

  const expiresAt = new Date(Date.now() + expires_in * 1000);

  await pool.query(
    `
    UPDATE wearable_tokens
    SET access_token=$1,
        refresh_token=$2,
        expires_at=$3,
        scope=$4,
        token_type=$5,
        updated_at=NOW()
    WHERE id=$6
    `,
    [
      access_token,
      refresh_token,
      expiresAt,
      scope,
      token_type,
      token.id,
    ]
  );

  return access_token;
}

/* -------------------------------------------
   4. STATUS CHECK (Frontend uses this)
--------------------------------------------*/
router.get("/status", async (req, res) => {
  const customerId = getCustomerId(req);
  if (!customerId) return res.json({ connected: false });

  const { rows } = await pool.query(
    `
    SELECT 1 FROM wearable_tokens
    WHERE customer_id=$1 AND provider='fitbit'
    `,
    [customerId]
  );

  res.json({ connected: rows.length > 0 });
});

/* -------------------------------------------
   5. TODAY ACTIVITY → Calories Burned
--------------------------------------------*/
router.get("/activity/today", async (req, res) => {
  const customerId = getCustomerId(req);
  if (!customerId) return res.status(401).json({ error: "Missing customer" });

  try {
    const token = await getValidFitbitToken(customerId);
    const today = new Date().toISOString().slice(0, 10);

    const resp = await axios.get(
      `https://api.fitbit.com/1/user/-/activities/date/${today}.json`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    res.json({
      caloriesBurned: resp.data.summary.caloriesOut,
      steps: resp.data.summary.steps,
      activeMinutes: resp.data.summary.fairlyActiveMinutes,
    });
  } catch (err) {
    console.error("Fitbit activity error", err);
    res.status(500).json({ error: "Failed to fetch Fitbit activity" });
  }
});

export default router;
