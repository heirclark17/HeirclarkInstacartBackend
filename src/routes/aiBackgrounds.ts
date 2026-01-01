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
  angle?: number;
}

interface PatternBackground {
  name: string;
  type: "pattern";
  pattern: string; // CSS pattern name: leopard, zebra, dots, stripes, geometric, marble, etc.
  baseColor: string;
  patternColor: string;
}

type CardBackground = SolidBackground | GradientBackground | PatternBackground;

interface AIBackgroundsResponse {
  backgrounds: CardBackground[];
}

// Validation schema
const generateBackgroundsSchema = z.object({
  prompt: z.string().min(2).max(200),
});

// System prompt for AI
const SYSTEM_PROMPT = `You are generating UI background presets for a premium nutrition/fitness app.
The user will describe what they want - you MUST match their request as closely as possible.

Return VALID JSON ONLY, matching this schema:
{
  "backgrounds": [
    { "name": "...", "type": "solid", "hex": "#rrggbb" },
    { "name": "...", "type": "gradient", "colors": ["#rrggbb", "#rrggbb"], "angle": 135 },
    { "name": "...", "type": "pattern", "pattern": "leopard", "baseColor": "#rrggbb", "patternColor": "#rrggbb" }
  ]
}

Background types:
1. solid: Single color { type: "solid", hex: "#rrggbb" }
2. gradient: 2-3 colors { type: "gradient", colors: ["#...", "#..."], angle: 135 }
3. pattern: CSS patterns { type: "pattern", pattern: "NAME", baseColor: "#...", patternColor: "#..." }

Available pattern names:
- leopard, zebra, tiger, cheetah (animal prints)
- dots, polkadots, confetti (dot patterns)
- stripes, diagonal-stripes, chevron (line patterns)
- geometric, triangles, hexagons, diamonds (shapes)
- marble, granite, terrazzo (stone textures)
- waves, ripples (organic patterns)
- grid, checkerboard (structured patterns)
- stars, hearts, floral (decorative)

CRITICAL RULES:
- Return EXACTLY 4 backgrounds
- MATCH THE USER'S REQUEST - if they ask for leopard print, give them leopard patterns
- If user asks for a pattern/texture, use the pattern type
- If user asks for colors only, use solid or gradient
- Mix types when appropriate for variety
- Names should be creative and descriptive
- No explanations, no markdown, ONLY valid JSON`;

// Fallback backgrounds if AI fails
const FALLBACK_BACKGROUNDS: CardBackground[] = [
  { name: "Midnight Black", type: "solid", hex: "#0a0a0a" },
  { name: "Pure White", type: "solid", hex: "#ffffff" },
  { name: "Ocean Gradient", type: "gradient", colors: ["#1a1a2e", "#16213e", "#0f3460"] },
  { name: "Sunset Glow", type: "gradient", colors: ["#2d1f3d", "#4a3f5c", "#6b5b7b"] },
];

// Valid pattern names
const VALID_PATTERNS = new Set([
  'leopard', 'zebra', 'tiger', 'cheetah',
  'dots', 'polkadots', 'confetti',
  'stripes', 'diagonal-stripes', 'chevron',
  'geometric', 'triangles', 'hexagons', 'diamonds',
  'marble', 'granite', 'terrazzo',
  'waves', 'ripples',
  'grid', 'checkerboard',
  'stars', 'hearts', 'floral'
]);

// Normalize pattern names (AI might return variations)
function normalizePatternName(name: string): string | null {
  const normalized = name.toLowerCase().replace(/[-_\s]+/g, '');

  // Direct matches
  if (VALID_PATTERNS.has(normalized)) return normalized;

  // Common variations
  const mappings: Record<string, string> = {
    'leopardprint': 'leopard',
    'leopardspot': 'leopard',
    'leopardspots': 'leopard',
    'zebraprint': 'zebra',
    'zebrastripe': 'zebra',
    'zebrastripes': 'zebra',
    'tigerprint': 'tiger',
    'tigerstripe': 'tiger',
    'tigerstripes': 'tiger',
    'cheetahprint': 'cheetah',
    'cheetahspot': 'cheetah',
    'cheetahspots': 'cheetah',
    'polkadot': 'polkadots',
    'dotted': 'dots',
    'spotted': 'dots',
    'striped': 'stripes',
    'stripe': 'stripes',
    'diagonalstripe': 'diagonal-stripes',
    'diagonalstriped': 'diagonal-stripes',
    'marbled': 'marble',
    'wavy': 'waves',
    'wave': 'waves',
    'ripple': 'ripples',
    'check': 'checkerboard',
    'checked': 'checkerboard',
    'checkered': 'checkerboard',
    'star': 'stars',
    'heart': 'hearts',
    'flower': 'floral',
    'flowers': 'floral',
    'triangle': 'triangles',
    'hexagon': 'hexagons',
    'diamond': 'diamonds',
    'geo': 'geometric',
  };

  if (mappings[normalized]) return mappings[normalized];

  // Partial match - check if any valid pattern is contained
  for (const pattern of VALID_PATTERNS) {
    if (normalized.includes(pattern) || pattern.includes(normalized)) {
      return pattern;
    }
  }

  return null;
}

/**
 * Validate that the AI response matches our expected schema
 * More lenient - tries to salvage valid backgrounds even if some are invalid
 */
function validateAIResponse(data: unknown): AIBackgroundsResponse | null {
  console.log("[ai-backgrounds] Raw AI response:", JSON.stringify(data, null, 2));

  if (!data || typeof data !== "object") {
    console.log("[ai-backgrounds] Invalid: not an object");
    return null;
  }

  const obj = data as Record<string, unknown>;
  if (!Array.isArray(obj.backgrounds)) {
    console.log("[ai-backgrounds] Invalid: backgrounds is not an array");
    return null;
  }

  const validBackgrounds: CardBackground[] = [];

  for (let i = 0; i < obj.backgrounds.length; i++) {
    const bg = obj.backgrounds[i];
    if (!bg || typeof bg !== "object") {
      console.log(`[ai-backgrounds] Skipping bg[${i}]: not an object`);
      continue;
    }
    const item = bg as Record<string, unknown>;

    if (typeof item.name !== "string") {
      console.log(`[ai-backgrounds] Skipping bg[${i}]: missing name`);
      continue;
    }

    if (item.type === "solid") {
      if (typeof item.hex !== "string" || !/^#[0-9A-Fa-f]{6}$/.test(item.hex)) {
        console.log(`[ai-backgrounds] Skipping bg[${i}]: invalid hex "${item.hex}"`);
        continue;
      }
      validBackgrounds.push({
        name: item.name,
        type: "solid",
        hex: item.hex,
      });
    } else if (item.type === "gradient") {
      if (!Array.isArray(item.colors) || item.colors.length < 2 || item.colors.length > 3) {
        console.log(`[ai-backgrounds] Skipping bg[${i}]: invalid colors array`);
        continue;
      }
      let validColors = true;
      for (const color of item.colors) {
        if (typeof color !== "string" || !/^#[0-9A-Fa-f]{6}$/.test(color)) {
          validColors = false;
          break;
        }
      }
      if (!validColors) {
        console.log(`[ai-backgrounds] Skipping bg[${i}]: invalid color in gradient`);
        continue;
      }
      validBackgrounds.push({
        name: item.name,
        type: "gradient",
        colors: item.colors as string[],
        angle: typeof item.angle === 'number' ? item.angle : 135,
      });
    } else if (item.type === "pattern") {
      const patternName = typeof item.pattern === "string" ? normalizePatternName(item.pattern) : null;
      if (!patternName) {
        console.log(`[ai-backgrounds] Skipping bg[${i}]: invalid pattern "${item.pattern}"`);
        continue;
      }
      if (typeof item.baseColor !== "string" || !/^#[0-9A-Fa-f]{6}$/.test(item.baseColor)) {
        console.log(`[ai-backgrounds] Skipping bg[${i}]: invalid baseColor "${item.baseColor}"`);
        continue;
      }
      if (typeof item.patternColor !== "string" || !/^#[0-9A-Fa-f]{6}$/.test(item.patternColor)) {
        console.log(`[ai-backgrounds] Skipping bg[${i}]: invalid patternColor "${item.patternColor}"`);
        continue;
      }
      validBackgrounds.push({
        name: item.name,
        type: "pattern",
        pattern: patternName,
        baseColor: item.baseColor,
        patternColor: item.patternColor,
      });
    } else {
      console.log(`[ai-backgrounds] Skipping bg[${i}]: unknown type "${item.type}"`);
      continue;
    }
  }

  console.log(`[ai-backgrounds] Validated ${validBackgrounds.length} backgrounds`);

  // Need at least 1 valid background
  if (validBackgrounds.length === 0) {
    return null;
  }

  // Pad to 4 if we have fewer (duplicate last one)
  while (validBackgrounds.length < 4) {
    const last = validBackgrounds[validBackgrounds.length - 1];
    validBackgrounds.push({ ...last, name: `${last.name} Alt` });
  }

  return { backgrounds: validBackgrounds.slice(0, 4) };
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

    console.log("[ai-backgrounds] Claude raw content:", content);

    // Parse JSON from response - handle markdown code blocks
    let jsonContent = content.trim();
    if (jsonContent.startsWith("```")) {
      jsonContent = jsonContent.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    const parsed = JSON.parse(jsonContent);
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
        model: "gpt-4o",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `Generate 4 card background presets based on this vibe/style: "${prompt}"`,
          },
        ],
        temperature: 0.8,
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

    console.log("[ai-backgrounds] OpenAI raw content:", content);

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
