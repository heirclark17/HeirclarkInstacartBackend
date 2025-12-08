import { Router, Request, Response } from "express";
import OpenAI from "openai";

const router = Router();
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

/**
 * POST /apps/weight-vision/image
 */
router.post("/image", async (req: Request, res: Response) => {
  try {
    const {
      height_cm,
      weight_kg,
      waist_cm,
      gender,
      body_fat,
      pose = "front",
      style = "simple silhouette, plain background",
    } = req.body || {};

    if (!height_cm || !weight_kg || !gender) {
      return res.status(400).json({
        error: "Missing required fields: height_cm, weight_kg, gender",
      });
    }

    // STEP 1 — Ask ChatGPT-4.1-mini to build prompt + morph targets
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content: `
You generate JSON for a fitness app.

You return:
1. image_prompt
2. morph_targets (numbers 0-1 for chest, waist, hips, arms, thighs)

Rules:
- Output MUST be valid JSON only.
- No extra text.
`,
        },
        {
          role: "user",
          content:
            "Generate prompt + morph targets for: " +
            JSON.stringify({
              height_cm,
              weight_kg,
              waist_cm,
              gender,
              body_fat,
              pose,
              style,
            }),
        },
      ],
      response_format: { type: "json_object" },
    });

    const raw = completion.choices[0].message?.content || "{}";
    const aiConfig = JSON.parse(raw);

    const imagePrompt =
      aiConfig.image_prompt ||
      `Full-body ${gender} silhouette, ${height_cm} cm, ${weight_kg} kg, ${style}`;

    const morphTargets =
      aiConfig.morph_targets || {
        chest: 0.3,
        waist: 0.3,
        hips: 0.3,
        arms: 0.3,
        thighs: 0.3,
      };

    // STEP 2 — Generate image (silhouette)
    const imageResponse = await openai.images.generate({
      model: "dall-e-3",
      prompt: imagePrompt,
      size: "1024x1024",
      n: 1,
    });

    const imageData = imageResponse.data?.[0];
    if (!imageData) {
      return res.status(500).json({ error: "Image generation failed" });
    }

    const base64 = imageData.b64_json;
    const image_url = base64
      ? `data:image/png;base64,${base64}`
      : imageData.url;

    // Final return
    return res.json({
      image_url,
      morph_targets: morphTargets,
      prompt_used: imagePrompt,
      pose,
      style,
    });
  } catch (err: any) {
    console.error("Weight Vision error:", err);
    return res.status(500).json({
      error: "Internal server error",
      details: err.message,
    });
  }
});

export default router;
