// GET /api/v1/health/devices?shopifyCustomerId=123
healthBridgeRouter.get("/devices", async (req: Request, res: Response) => {
  const shopifyCustomerId = String(req.query?.shopifyCustomerId || "").trim();
  if (!shopifyCustomerId) {
    return res.status(400).json({ ok: false, error: "Missing shopifyCustomerId" });
  }

  try {
    const out = await pool.query(
      `
      SELECT device_key, created_at, last_seen_at
      FROM hc_health_devices
      WHERE shopify_customer_id = $1
      ORDER BY last_seen_at DESC
      `,
      [shopifyCustomerId]
    );

    return res.json({
      ok: true,
      devices: out.rows.map((r) => ({
        deviceKey: r.device_key,
        createdAt: r.created_at,
        lastSeenAt: r.last_seen_at,
      })),
    });
  } catch (err: any) {
    console.error("[healthBridge] devices failed:", err);
    return res.status(500).json({ ok: false, error: "devices failed" });
  }
});
