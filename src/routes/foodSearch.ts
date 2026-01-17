import express, { Request, Response } from 'express';
import { z } from 'zod';
import axios from 'axios';

const foodSearchRouter = express.Router();

// Validation schemas
const searchFoodSchema = z.object({
  query: z.string().min(1, 'Search query required'),
  page: z.number().min(1).optional().default(1),
  pageSize: z.number().min(1).max(50).optional().default(10),
});

const getFoodByBarcodeSchema = z.object({
  barcode: z.string().min(8, 'Barcode must be at least 8 digits'),
});

/**
 * POST /api/v1/food/search
 * Search for foods by name using Open Food Facts API
 */
foodSearchRouter.post('/search', async (req: Request, res: Response) => {
  try {
    const { query, page, pageSize } = searchFoodSchema.parse(req.body);

    // Call Open Food Facts API
    const response = await axios.get('https://world.openfoodfacts.org/cgi/search.pl', {
      params: {
        search_terms: query,
        page,
        page_size: pageSize,
        json: true,
        fields: 'code,product_name,brands,nutriments,nutriscore_grade,nova_group,image_url,serving_size',
      },
      headers: {
        'User-Agent': 'HeirclarkNutrition/1.0 (contact@heirclark.com)',
      },
    });

    const products = response.data.products || [];

    // Transform to simplified format
    const foods = products.map((product: any) => ({
      id: product.code,
      name: product.product_name,
      brand: product.brands,
      image: product.image_url,
      servingSize: product.serving_size,
      nutriScore: product.nutriscore_grade,
      novaGroup: product.nova_group,
      nutrients: {
        calories: product.nutriments?.['energy-kcal_100g'] || product.nutriments?.energy_100g,
        protein: product.nutriments?.proteins_100g,
        carbs: product.nutriments?.carbohydrates_100g,
        fat: product.nutriments?.fat_100g,
        fiber: product.nutriments?.fiber_100g,
        sugar: product.nutriments?.sugars_100g,
        sodium: product.nutriments?.sodium_100g,
        saturatedFat: product.nutriments?.['saturated-fat_100g'],
      },
    }));

    return res.json({
      success: true,
      query,
      page,
      pageSize,
      totalResults: response.data.count || 0,
      foods,
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
 * Browse popular/recent foods from Open Food Facts
 */
foodSearchRouter.get('/browse', async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 10;

    // Get foods sorted by popularity (completeness score)
    const response = await axios.get('https://world.openfoodfacts.org/cgi/search.pl', {
      params: {
        page,
        page_size: pageSize,
        json: true,
        sort_by: 'unique_scans_n',
        fields: 'code,product_name,brands,nutriments,nutriscore_grade,nova_group,image_url,serving_size',
      },
      headers: {
        'User-Agent': 'HeirclarkNutrition/1.0 (contact@heirclark.com)',
      },
    });

    const products = response.data.products || [];

    const foods = products.map((product: any) => ({
      id: product.code,
      name: product.product_name,
      brand: product.brands,
      image: product.image_url,
      servingSize: product.serving_size,
      nutriScore: product.nutriscore_grade,
      novaGroup: product.nova_group,
      nutrients: {
        calories: product.nutriments?.['energy-kcal_100g'] || product.nutriments?.energy_100g,
        protein: product.nutriments?.proteins_100g,
        carbs: product.nutriments?.carbohydrates_100g,
        fat: product.nutriments?.fat_100g,
        fiber: product.nutriments?.fiber_100g,
        sugar: product.nutriments?.sugars_100g,
        sodium: product.nutriments?.sodium_100g,
        saturatedFat: product.nutriments?.['saturated-fat_100g'],
      },
    }));

    return res.json({
      success: true,
      page,
      pageSize,
      totalResults: response.data.count || 0,
      foods,
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
 * Get detailed food information by product code
 */
foodSearchRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const response = await axios.get(`https://world.openfoodfacts.org/api/v2/product/${id}`, {
      headers: {
        'User-Agent': 'HeirclarkNutrition/1.0 (contact@heirclark.com)',
      },
    });

    if (response.data.status !== 1 || !response.data.product) {
      return res.status(404).json({
        success: false,
        error: 'Food not found',
      });
    }

    const product = response.data.product;

    const food = {
      id: product.code,
      name: product.product_name,
      brand: product.brands,
      image: product.image_url,
      servingSize: product.serving_size,
      nutriScore: product.nutriscore_grade,
      novaGroup: product.nova_group,
      ingredients: product.ingredients_text,
      allergens: product.allergens,
      nutrients: {
        calories: product.nutriments?.['energy-kcal_100g'] || product.nutriments?.energy_100g,
        protein: product.nutriments?.proteins_100g,
        carbs: product.nutriments?.carbohydrates_100g,
        fat: product.nutriments?.fat_100g,
        fiber: product.nutriments?.fiber_100g,
        sugar: product.nutriments?.sugars_100g,
        sodium: product.nutriments?.sodium_100g,
        saturatedFat: product.nutriments?.['saturated-fat_100g'],
        cholesterol: product.nutriments?.cholesterol_100g,
        calcium: product.nutriments?.calcium_100g,
        iron: product.nutriments?.iron_100g,
        vitaminA: product.nutriments?.['vitamin-a_100g'],
        vitaminC: product.nutriments?.['vitamin-c_100g'],
      },
    };

    return res.json({
      success: true,
      food,
    });
  } catch (error: any) {
    console.error('[Food Search] Error getting food by ID:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to get food details',
    });
  }
});

/**
 * POST /api/v1/food/barcode
 * Look up food by barcode
 */
foodSearchRouter.post('/barcode', async (req: Request, res: Response) => {
  try {
    const { barcode } = getFoodByBarcodeSchema.parse(req.body);

    const response = await axios.get(`https://world.openfoodfacts.org/api/v2/product/${barcode}`, {
      headers: {
        'User-Agent': 'HeirclarkNutrition/1.0 (contact@heirclark.com)',
      },
    });

    if (response.data.status !== 1 || !response.data.product) {
      return res.status(404).json({
        success: false,
        error: 'Product not found for this barcode',
      });
    }

    const product = response.data.product;

    const food = {
      id: product.code,
      name: product.product_name,
      brand: product.brands,
      image: product.image_url,
      servingSize: product.serving_size,
      nutriScore: product.nutriscore_grade,
      novaGroup: product.nova_group,
      ingredients: product.ingredients_text,
      allergens: product.allergens,
      nutrients: {
        calories: product.nutriments?.['energy-kcal_100g'] || product.nutriments?.energy_100g,
        protein: product.nutriments?.proteins_100g,
        carbs: product.nutriments?.carbohydrates_100g,
        fat: product.nutriments?.fat_100g,
        fiber: product.nutriments?.fiber_100g,
        sugar: product.nutriments?.sugars_100g,
        sodium: product.nutriments?.sodium_100g,
        saturatedFat: product.nutriments?.['saturated-fat_100g'],
      },
    };

    return res.json({
      success: true,
      food,
    });
  } catch (error: any) {
    console.error('[Food Search] Error looking up barcode:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to look up barcode',
    });
  }
});

export default foodSearchRouter;
