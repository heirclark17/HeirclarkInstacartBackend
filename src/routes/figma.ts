// src/routes/figma.ts
import { Router, Request, Response } from "express";
import {
  getFigmaFile,
  getFigmaNodes,
  getFigmaImages,
  getFigmaStyles,
  getFigmaComments,
  extractColorPalette,
  healthCheck,
} from "../services/figmaService";
import { authMiddleware } from "../middleware/auth";

export const figmaRouter = Router();

/**
 * Health check endpoint - NO AUTH required
 * GET /api/v1/figma/health
 * Tests if Figma API key is valid
 */
figmaRouter.get("/health", async (req: Request, res: Response) => {
  try {
    const result = await healthCheck();
    return res.json(result);
  } catch (error: any) {
    return res.status(500).json({
      status: 'error',
      message: error.message,
    });
  }
});

/**
 * Apply authentication to all routes below
 */
figmaRouter.use(authMiddleware());

/**
 * Get Figma file
 * GET /api/v1/figma/file/:fileKey
 * Returns complete Figma file data including document, components, and styles
 */
figmaRouter.get("/file/:fileKey", async (req: Request, res: Response) => {
  try {
    const { fileKey } = req.params;

    if (!fileKey) {
      return res.status(400).json({
        ok: false,
        error: "Missing fileKey parameter"
      });
    }

    const data = await getFigmaFile(fileKey);
    return res.json({ ok: true, data });
  } catch (error: any) {
    console.error('Figma file fetch error:', error);
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

/**
 * Get specific nodes from a Figma file
 * GET /api/v1/figma/nodes/:fileKey?ids=node1,node2,node3
 * Returns node data for the specified IDs
 */
figmaRouter.get("/nodes/:fileKey", async (req: Request, res: Response) => {
  try {
    const { fileKey } = req.params;
    const idsParam = String(req.query?.ids || "").trim();

    if (!fileKey) {
      return res.status(400).json({
        ok: false,
        error: "Missing fileKey parameter"
      });
    }

    if (!idsParam) {
      return res.status(400).json({
        ok: false,
        error: "Missing ids query parameter"
      });
    }

    const nodeIds = idsParam.split(',').map(id => id.trim()).filter(Boolean);

    if (nodeIds.length === 0) {
      return res.status(400).json({
        ok: false,
        error: "No valid node IDs provided"
      });
    }

    const data = await getFigmaNodes(fileKey, nodeIds);
    return res.json({ ok: true, data });
  } catch (error: any) {
    console.error('Figma nodes fetch error:', error);
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

/**
 * Export Figma nodes as images
 * GET /api/v1/figma/images/:fileKey?ids=node1,node2&format=png&scale=2
 * Returns image URLs for the specified nodes
 *
 * Query params:
 * - ids: Comma-separated node IDs (required)
 * - format: png | jpg | svg | pdf (default: png)
 * - scale: 1-4 (default: 2)
 */
figmaRouter.get("/images/:fileKey", async (req: Request, res: Response) => {
  try {
    const { fileKey } = req.params;
    const idsParam = String(req.query?.ids || "").trim();
    const format = String(req.query?.format || "png").trim() as 'png' | 'jpg' | 'svg' | 'pdf';
    const scale = parseInt(String(req.query?.scale || "2"));

    if (!fileKey) {
      return res.status(400).json({
        ok: false,
        error: "Missing fileKey parameter"
      });
    }

    if (!idsParam) {
      return res.status(400).json({
        ok: false,
        error: "Missing ids query parameter"
      });
    }

    const nodeIds = idsParam.split(',').map(id => id.trim()).filter(Boolean);

    if (nodeIds.length === 0) {
      return res.status(400).json({
        ok: false,
        error: "No valid node IDs provided"
      });
    }

    if (!['png', 'jpg', 'svg', 'pdf'].includes(format)) {
      return res.status(400).json({
        ok: false,
        error: "Invalid format. Must be: png, jpg, svg, or pdf"
      });
    }

    if (scale < 1 || scale > 4 || isNaN(scale)) {
      return res.status(400).json({
        ok: false,
        error: "Invalid scale. Must be between 1 and 4"
      });
    }

    const data = await getFigmaImages(fileKey, nodeIds, format, scale);
    return res.json({ ok: true, data });
  } catch (error: any) {
    console.error('Figma images export error:', error);
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

/**
 * Get Figma file styles
 * GET /api/v1/figma/styles/:fileKey
 * Returns all color, text, effect, and grid styles from the file
 */
figmaRouter.get("/styles/:fileKey", async (req: Request, res: Response) => {
  try {
    const { fileKey } = req.params;

    if (!fileKey) {
      return res.status(400).json({
        ok: false,
        error: "Missing fileKey parameter"
      });
    }

    const data = await getFigmaStyles(fileKey);
    return res.json({ ok: true, data });
  } catch (error: any) {
    console.error('Figma styles fetch error:', error);
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

/**
 * Get Figma file comments
 * GET /api/v1/figma/comments/:fileKey
 * Returns all comments from the file
 */
figmaRouter.get("/comments/:fileKey", async (req: Request, res: Response) => {
  try {
    const { fileKey } = req.params;

    if (!fileKey) {
      return res.status(400).json({
        ok: false,
        error: "Missing fileKey parameter"
      });
    }

    const data = await getFigmaComments(fileKey);
    return res.json({ ok: true, data });
  } catch (error: any) {
    console.error('Figma comments fetch error:', error);
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

/**
 * Extract color palette from Figma file
 * GET /api/v1/figma/colors/:fileKey
 * Returns array of unique hex colors used in the file
 */
figmaRouter.get("/colors/:fileKey", async (req: Request, res: Response) => {
  try {
    const { fileKey } = req.params;

    if (!fileKey) {
      return res.status(400).json({
        ok: false,
        error: "Missing fileKey parameter"
      });
    }

    const colors = await extractColorPalette(fileKey);
    return res.json({ ok: true, data: { colors, count: colors.length } });
  } catch (error: any) {
    console.error('Color palette extraction error:', error);
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});
