import express, { Request, Response } from 'express';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import agentConfig from '../../config/agentConfig.json';

const foodSearchRouter = express.Router();

// Validation schemas
const searchFoodSchema = z.object({
  query: z.string().min(1, 'Search query required'),
  page: z.number().min(1).optional().default(1),
  pageSize: z.number().min(1).max(50).optional().default(10),
});

const getFoodByIdSchema = z.object({
  id: z.string().startsWith('fd_', 'Food ID must start with fd_'),
});

const getFoodByBarcodeSchema = z.object({
  barcode: z.string().length(13, 'Barcode must be exactly 13 digits'),
});

// Helper function to connect to OpenNutrition MCP
async function getOpenNutritionClient(): Promise<Client> {
  const config = agentConfig.mcpServers['opennutrition-mcp'];

  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args,
    env: config.env,
  });

  const client = new Client(
    {
      name: 'heirclark-food-search',
      version: '1.0.0',
    },
    { capabilities: {} }
  );

  await client.connect(transport);
  return client;
}

/**
 * POST /api/v1/food/search
 * Search for foods by name, brand, or partial matches
 */
foodSearchRouter.post('/search', async (req: Request, res: Response) => {
  try {
    const { query, page, pageSize } = searchFoodSchema.parse(req.body);

    const client = await getOpenNutritionClient();

    const result: any = await client.callTool({
      name: 'search-food-by-name',
      arguments: {
        query,
        page,
        pageSize,
      },
    });

    // Parse the result
    const foodData = JSON.parse(result.content[0].text);

    return res.json({
      success: true,
      query,
      page,
      pageSize,
      totalResults: foodData.totalCount || 0,
      foods: foodData.foods || foodData,
    });
  } catch (error: any) {
    console.error('[Food Search] Error searching foods:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to search foods',
    });
  }
});

/**
 * GET /api/v1/food/browse
 * Browse paginated list of all foods
 */
foodSearchRouter.get('/browse', async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 10;

    const client = await getOpenNutritionClient();

    const result: any = await client.callTool({
      name: 'get-foods',
      arguments: {
        page,
        pageSize,
      },
    });

    const foodData = JSON.parse(result.content[0].text);

    return res.json({
      success: true,
      page,
      pageSize,
      totalResults: foodData.totalCount || 0,
      foods: foodData.foods || foodData,
    });
  } catch (error: any) {
    console.error('[Food Search] Error browsing foods:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to browse foods',
    });
  }
});

/**
 * GET /api/v1/food/:id
 * Get detailed food information by ID
 */
foodSearchRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = getFoodByIdSchema.parse({ id: req.params.id });

    const client = await getOpenNutritionClient();

    const result: any = await client.callTool({
      name: 'get-food-by-id',
      arguments: { id },
    });

    const foodData = JSON.parse(result.content[0].text);

    return res.json({
      success: true,
      food: foodData.food || foodData,
    });
  } catch (error: any) {
    console.error('[Food Search] Error getting food by ID:', error);
    return res.status(400).json({
      success: false,
      error: error.message || 'Failed to get food details',
    });
  }
});

/**
 * POST /api/v1/food/barcode
 * Look up food by EAN-13 barcode
 */
foodSearchRouter.post('/barcode', async (req: Request, res: Response) => {
  try {
    const { barcode } = getFoodByBarcodeSchema.parse(req.body);

    const client = await getOpenNutritionClient();

    const result: any = await client.callTool({
      name: 'get-food-by-ean13',
      arguments: { ean_13: barcode },
    });

    const foodData = JSON.parse(result.content[0].text);

    return res.json({
      success: true,
      food: foodData.food || foodData,
    });
  } catch (error: any) {
    console.error('[Food Search] Error looking up barcode:', error);
    return res.status(400).json({
      success: false,
      error: error.message || 'Failed to look up barcode',
    });
  }
});

export default foodSearchRouter;
