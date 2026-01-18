/**
 * Figma API Service
 * Provides access to Figma files, nodes, styles, and exports
 */

import { ENV } from '../env';

// Figma configuration
const FIGMA_CONFIG = {
  apiKey: ENV.FIGMA_API_KEY,
  baseUrl: 'https://api.figma.com/v1',
  timeout: 30000, // 30 seconds
};

// Type definitions
export interface FigmaFile {
  name: string;
  lastModified: string;
  thumbnailUrl: string;
  version: string;
  document: FigmaNode;
  components: Record<string, FigmaComponent>;
  styles: Record<string, FigmaStyle>;
}

export interface FigmaNode {
  id: string;
  name: string;
  type: string;
  children?: FigmaNode[];
  fills?: any[];
  strokes?: any[];
  effects?: any[];
  absoluteBoundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  [key: string]: any;
}

export interface FigmaComponent {
  key: string;
  name: string;
  description: string;
  remote: boolean;
}

export interface FigmaStyle {
  key: string;
  name: string;
  description: string;
  styleType: 'FILL' | 'TEXT' | 'EFFECT' | 'GRID';
}

/**
 * Get headers for Figma API requests
 */
function getFigmaHeaders(): HeadersInit {
  if (!FIGMA_CONFIG.apiKey) {
    throw new Error('FIGMA_API_KEY environment variable is required');
  }
  return {
    'X-Figma-Token': FIGMA_CONFIG.apiKey,
    'Content-Type': 'application/json',
  };
}

/**
 * Fetch a Figma file by its file key
 * @param fileKey - The Figma file key from URL: figma.com/file/{fileKey}/...
 * @returns Complete Figma file data
 */
export async function getFigmaFile(fileKey: string): Promise<FigmaFile> {
  try {
    console.log(`📦 Fetching Figma file: ${fileKey}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FIGMA_CONFIG.timeout);

    const response = await fetch(
      `${FIGMA_CONFIG.baseUrl}/files/${fileKey}`,
      {
        headers: getFigmaHeaders(),
        signal: controller.signal,
      }
    );

    clearTimeout(timeoutId);

    if (!response.ok) {
      if (response.status === 403) {
        throw new Error('Invalid Figma API key or insufficient permissions');
      }
      if (response.status === 404) {
        throw new Error(`Figma file not found: ${fileKey}`);
      }
      throw new Error(`Figma API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    console.log(`✅ Successfully fetched Figma file: ${data.name}`);

    return data;
  } catch (error: any) {
    console.error('❌ Error fetching Figma file:', error.message);
    throw error;
  }
}

/**
 * Get specific nodes from a Figma file
 * @param fileKey - The Figma file key
 * @param nodeIds - Array of node IDs to fetch
 * @returns Node data for requested IDs
 */
export async function getFigmaNodes(
  fileKey: string,
  nodeIds: string[]
): Promise<{ nodes: Record<string, { document: FigmaNode }> }> {
  try {
    console.log(`📦 Fetching ${nodeIds.length} nodes from file: ${fileKey}`);

    const idsParam = nodeIds.join(',');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FIGMA_CONFIG.timeout);

    const response = await fetch(
      `${FIGMA_CONFIG.baseUrl}/files/${fileKey}/nodes?ids=${idsParam}`,
      {
        headers: getFigmaHeaders(),
        signal: controller.signal,
      }
    );

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Figma API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    console.log(`✅ Successfully fetched ${nodeIds.length} nodes`);

    return data;
  } catch (error: any) {
    console.error('❌ Error fetching Figma nodes:', error.message);
    throw error;
  }
}

/**
 * Export Figma nodes as images
 * @param fileKey - The Figma file key
 * @param nodeIds - Array of node IDs to export
 * @param format - Image format (png, jpg, svg, pdf)
 * @param scale - Scale multiplier (1-4)
 * @returns Object with image URLs keyed by node ID
 */
export async function getFigmaImages(
  fileKey: string,
  nodeIds: string[],
  format: 'png' | 'jpg' | 'svg' | 'pdf' = 'png',
  scale: number = 2
): Promise<{ images: Record<string, string> }> {
  try {
    console.log(`🖼️  Exporting ${nodeIds.length} images as ${format} (${scale}x)`);

    const idsParam = nodeIds.join(',');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FIGMA_CONFIG.timeout);

    const response = await fetch(
      `${FIGMA_CONFIG.baseUrl}/images/${fileKey}?ids=${idsParam}&format=${format}&scale=${scale}`,
      {
        headers: getFigmaHeaders(),
        signal: controller.signal,
      }
    );

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Figma API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    console.log(`✅ Successfully exported ${nodeIds.length} images`);

    return data;
  } catch (error: any) {
    console.error('❌ Error exporting Figma images:', error.message);
    throw error;
  }
}

/**
 * Get file styles (colors, text styles, effects)
 * @param fileKey - The Figma file key
 * @returns All styles defined in the file
 */
export async function getFigmaStyles(fileKey: string): Promise<{ styles: Record<string, FigmaStyle> }> {
  try {
    console.log(`🎨 Fetching styles from file: ${fileKey}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FIGMA_CONFIG.timeout);

    const response = await fetch(
      `${FIGMA_CONFIG.baseUrl}/files/${fileKey}/styles`,
      {
        headers: getFigmaHeaders(),
        signal: controller.signal,
      }
    );

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Figma API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    console.log(`✅ Successfully fetched file styles`);

    return data;
  } catch (error: any) {
    console.error('❌ Error fetching Figma styles:', error.message);
    throw error;
  }
}

/**
 * Get file comments
 * @param fileKey - The Figma file key
 * @returns All comments in the file
 */
export async function getFigmaComments(fileKey: string): Promise<{ comments: any[] }> {
  try {
    console.log(`💬 Fetching comments from file: ${fileKey}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FIGMA_CONFIG.timeout);

    const response = await fetch(
      `${FIGMA_CONFIG.baseUrl}/files/${fileKey}/comments`,
      {
        headers: getFigmaHeaders(),
        signal: controller.signal,
      }
    );

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Figma API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    console.log(`✅ Successfully fetched ${data.comments?.length || 0} comments`);

    return data;
  } catch (error: any) {
    console.error('❌ Error fetching Figma comments:', error.message);
    throw error;
  }
}

/**
 * Extract color palette from Figma file
 * Analyzes all fills in the document to extract unique colors
 */
export async function extractColorPalette(fileKey: string): Promise<string[]> {
  try {
    const file = await getFigmaFile(fileKey);
    const colors = new Set<string>();

    function traverseNode(node: FigmaNode) {
      // Extract colors from fills
      if (node.fills && Array.isArray(node.fills)) {
        node.fills.forEach((fill: any) => {
          if (fill.type === 'SOLID' && fill.color) {
            const { r, g, b } = fill.color;
            const hex = `#${Math.round(r * 255).toString(16).padStart(2, '0')}${Math.round(g * 255).toString(16).padStart(2, '0')}${Math.round(b * 255).toString(16).padStart(2, '0')}`.toUpperCase();
            colors.add(hex);
          }
        });
      }

      // Extract colors from strokes
      if (node.strokes && Array.isArray(node.strokes)) {
        node.strokes.forEach((stroke: any) => {
          if (stroke.type === 'SOLID' && stroke.color) {
            const { r, g, b } = stroke.color;
            const hex = `#${Math.round(r * 255).toString(16).padStart(2, '0')}${Math.round(g * 255).toString(16).padStart(2, '0')}${Math.round(b * 255).toString(16).padStart(2, '0')}`.toUpperCase();
            colors.add(hex);
          }
        });
      }

      // Recurse through children
      if (node.children) {
        node.children.forEach(traverseNode);
      }
    }

    traverseNode(file.document);

    const palette = Array.from(colors);
    console.log(`🎨 Extracted ${palette.length} unique colors`);

    return palette;
  } catch (error: any) {
    console.error('❌ Error extracting color palette:', error.message);
    throw error;
  }
}

/**
 * Health check for Figma API connectivity
 * Tests if the API key is valid
 */
export async function healthCheck(): Promise<{ status: 'ok' | 'error'; message: string }> {
  try {
    // Try to fetch user info to verify API key
    const response = await fetch(`${FIGMA_CONFIG.baseUrl}/me`, {
      headers: getFigmaHeaders(),
    });

    if (!response.ok) {
      return {
        status: 'error',
        message: `Figma API returned ${response.status}`,
      };
    }

    const data = await response.json();
    return {
      status: 'ok',
      message: `Connected as ${data.email || 'unknown user'}`,
    };
  } catch (error: any) {
    return {
      status: 'error',
      message: error.message,
    };
  }
}
