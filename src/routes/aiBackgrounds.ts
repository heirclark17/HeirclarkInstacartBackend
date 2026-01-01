// src/routes/aiBackgrounds.ts
// AI-powered card background generation endpoint
// Uses Claude/OpenAI to generate premium color palettes

import { Router, Response } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/asyncHandler";
import { authMiddleware, AuthenticatedRequest } from "../middleware/auth";
import { sendSuccess, sendError, sendValidationError } from "../middleware/responseHelper";

export const aiBackgroundsRouter = Router();

// Types for background responses
interface SolidBackground {
  name: string;
  type: "solid";
  hex: string;
}

interface GradientBackground {
  name: string;
  type: "gradient";
  colors: string[];
}

type CardBackground = SolidBackground | GradientBackground;

interface AIBackgroundsResponse {
  backgrounds: CardBackground[];
}

// Validation schema
const generateBackgroundsSchema = z.object({
  prompt: z.string().min(2).max(200),
});

// System prompt for AI
const SYSTEM_PROMPT = `You are generating UI card background presets for a premium nutrition/fitness app.
Return VALID JSON ONLY, matching exactly this schema:
{
  "backgrounds": [
    { "name": "…", "type": "solid", "hex": "#rrggbb" },
    { "name": "…", "type": "gradient", "colors": ["#rrggbb", "#rrggbb"] }
  ]
}
Rules:
- Return exactly 4 backgrounds.
- Each background must be either solid (hex) or gradient (2–3 hex colors).
- Palettes must be premium, modern, and nutrition-app appropriate.
- Ensure strong readability: backgrounds should allow white or near-black text to be readable.
- Include a mix of dark and light options when possible.
- No explanations, no markdown, no extra keys, JSON only.`;

// Fallback backgrounds if AI fails
const FALLBACK_BACKGROUNDS: CardBackground[] = [
  { name: "Midnight Black", type: "solid", hex: "#0a0a0a" },
  { name: "Pure White", type: "solid", hex: "#ffffff" },
  { name: "Ocean Gradient", type: "gradient", colors: ["#1a1a2e", "#16213e", "#0f3460"] },
  { name: "Sunset Glow", type: "gradient", colors: ["#2d1f3d", "#4a3f5c", "#6b5b7b"] },
];

/**
 * Validate that the AI response matches our expected schema
 */
function validateAIResponse(data: unknown): AIBackgroundsResponse | null {
  if (!data || typeof data !== "object") return null;

  const obj = data as Record<string, unknown>;
  if (!Array.isArray(obj.backgrounds)) return null;
  if (obj.backgrounds.length !== 4) return null;

  const validBackgrounds: CardBackground[] = [];

  for (const bg of obj.backgrounds) {
    if (!bg || typeof bg !== "object") return null;
    const item = bg as Record<string, unknown>;

    if (typeof item.name !== "string") return null;

    if (item.type === "solid") {
      if (typeof item.hex !== "string" || !/^#[0-9A-Fa-f]{6}$/.test(item.hex)) {
        return null;
      }
      validBackgrounds.push({
        name: item.name,
        type: "solid",
        hex: item.hex,
      });
    } else if (item.type === "gradient") {
      if (!Array.isArray(item.colors) || item.colors.length < 2 || item.colors.length > 3) {
        return null;
      }
      for (const color of item.colors) {
        if (typeof color !== "string" || !/^#[0-9A-Fa-f]{6}$/.test(color)) {
          return null;
        }
      }
      validBackgrounds.push({
        name: item.name,
        type: "gradient",
        colors: item.colors as string[],
      });
    } else {
      return null;
    }
  }

  return { backgrounds: validBackgrounds };
}

/**
 * Call Claude API to generate backgrounds
 */
async function callClaudeAPI(prompt: string): Promise<AIBackgroundsResponse | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn("[ai-backgrounds] ANTHROPIC_API_KEY not configured");
    return null;
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: `Generate 4 card background presets based on this vibe/style: "${prompt}"`,
          },
        ],
        system: SYSTEM_PROMPT,
      }),
    });

    if (!response.ok) {
      console.error("[ai-backgrounds] Claude API error:", response.status, await response.text());
      return null;
    }

    const data = await response.json();
    const content = data.content?.[0]?.text;

    if (!content) {
      console.error("[ai-backgrounds] No content in Claude response");
      return null;
    }

    // Parse JSON from response
    const parsed = JSON.parse(content);
    return validateAIResponse(parsed);
  } catch (err) {
    console.error("[ai-backgrounds] Claude API call failed:", err);
    return null;
  }
}

/**
 * Call OpenAI API as fallback
 */
async function callOpenAIAPI(prompt: string): Promise<AIBackgroundsResponse | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("[ai-backgrounds] OPENAI_API_KEY not configured");
    return null;
  }

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `Generate 4 card background presets based on this vibe/style: "${prompt}"`,
          },
        ],
        temperature: 0.7,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      console.error("[ai-backgrounds] OpenAI API error:", response.status, await response.text());
      return null;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      console.error("[ai-backgrounds] No content in OpenAI response");
      return null;
    }

    const parsed = JSON.parse(content);
    return validateAIResponse(parsed);
  } catch (err) {
    console.error("[ai-backgrounds] OpenAI API call failed:", err);
    return null;
  }
}

/**
 * POST /api/v1/ai-backgrounds
 * Generate AI-powered card background presets
 */
aiBackgroundsRouter.post(
  "/",
  authMiddleware({ required: false }), // Allow anonymous for preview, require auth for saving
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    // Validate request body
    const parseResult = generateBackgroundsSchema.safeParse(req.body);
    if (!parseResult.success) {
      return sendValidationError(
        res,
        parseResult.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`)
      );
    }

    const { prompt } = parseResult.data;

    // Try Claude first, then OpenAI, then fallback
    let result = await callClaudeAPI(prompt);

    if (!result) {
      console.log("[ai-backgrounds] Claude failed, trying OpenAI...");
      result = await callOpenAIAPI(prompt);
    }

    if (!result) {
      // If AI fails, try once more with a stricter prompt
      console.log("[ai-backgrounds] Retrying with stricter prompt...");
      const strictPrompt = `${prompt}. Remember: ONLY output valid JSON with exactly 4 backgrounds. No markdown, no explanations.`;
      result = await callClaudeAPI(strictPrompt) || await callOpenAIAPI(strictPrompt);
    }

    if (!result) {
      console.warn("[ai-backgrounds] All AI attempts failed, using fallback");
      result = { backgrounds: FALLBACK_BACKGROUNDS };
    }

    return sendSuccess(res, result);
  })
);

export default aiBackgroundsRouter;
