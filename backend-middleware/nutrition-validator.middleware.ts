import { Request, Response, NextFunction } from 'express';
import Anthropic from '@anthropic-ai/sdk';

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Type definitions
interface NutritionInput {
  food_name: string;
  calories: number;
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
  serving_size?: string;
}

interface ValidationResult {
  validated: boolean | null;
  input: NutritionInput;
  usda_data: {
    food_name: string;
    fdc_id: string;
    calories: number;
    protein_g: number;
    carbs_g: number;
    fat_g: number;
    serving_size_g: number;
  } | null;
  discrepancies: Array<{
    field: string;
    input_value: number;
    usda_value: number;
    difference_percent: number;
  }>;
  corrections: {
    calories?: number;
    protein_g?: number;
    carbs_g?: number;
    fat_g?: number;
  } | null;
  confidence: number;
  recommendation: string;
}

// Extend Express Request to include validated nutrition
declare global {
  namespace Express {
    interface Request {
      validated_nutrition?: ValidationResult;
    }
  }
}

/**
 * NutritionValidator Middleware
 *
 * Validates food nutrition data against USDA database using Claude + OpenNutrition MCP.
 * Attaches validation results to req.validated_nutrition.
 *
 * Usage:
 *   app.post('/api/foods', nutritionValidator, createFoodHandler);
 */
export const nutritionValidator = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { food_name, calories, protein_g, carbs_g, fat_g, serving_size } = req.body;

    // Skip validation if no food data provided
    if (!food_name || calories === undefined) {
      return next();
    }

    const nutritionInput: NutritionInput = {
      food_name,
      calories,
      protein_g,
      carbs_g,
      fat_g,
      serving_size: serving_size || '100g',
    };

    // Call Claude with NutritionValidator skill
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: `You are a nutrition validation assistant. Use the OpenNutrition MCP to validate food nutrition data against the USDA database.

Instructions:
1. Search the USDA database for the food item
2. Compare the provided values against USDA data
3. Flag any discrepancies >10%
4. Return a JSON validation result

Always respond with valid JSON matching this schema:
{
  "validated": boolean | null,
  "input": { food_name, calories, protein_g, carbs_g, fat_g, serving_size },
  "usda_data": { food_name, fdc_id, calories, protein_g, carbs_g, fat_g, serving_size_g } | null,
  "discrepancies": [{ field, input_value, usda_value, difference_percent }],
  "corrections": { calories?, protein_g?, carbs_g?, fat_g? } | null,
  "confidence": number (0-100),
  "recommendation": string
}`,
      messages: [
        {
          role: 'user',
          content: `Validate this nutrition data against USDA database:

Food: ${nutritionInput.food_name}
Calories: ${nutritionInput.calories}
Protein: ${nutritionInput.protein_g || 'not provided'}g
Carbs: ${nutritionInput.carbs_g || 'not provided'}g
Fat: ${nutritionInput.fat_g || 'not provided'}g
Serving size: ${nutritionInput.serving_size}

Return validation result as JSON.`,
        },
      ],
    });

    // Extract text content from response
    const textContent = message.content.find(block => block.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No text response from Claude');
    }

    // Parse validation result
    const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }

    const validationResult: ValidationResult = JSON.parse(jsonMatch[0]);

    // Attach to request for downstream handlers
    req.validated_nutrition = validationResult;

    // If corrections needed, optionally update request body
    if (validationResult.corrections && !validationResult.validated) {
      // Store original values
      req.body._original_nutrition = { ...nutritionInput };

      // Apply corrections (optional - can be controlled via config)
      if (process.env.AUTO_CORRECT_NUTRITION === 'true') {
        if (validationResult.corrections.calories !== undefined) {
          req.body.calories = validationResult.corrections.calories;
        }
        if (validationResult.corrections.protein_g !== undefined) {
          req.body.protein_g = validationResult.corrections.protein_g;
        }
        if (validationResult.corrections.carbs_g !== undefined) {
          req.body.carbs_g = validationResult.corrections.carbs_g;
        }
        if (validationResult.corrections.fat_g !== undefined) {
          req.body.fat_g = validationResult.corrections.fat_g;
        }
        req.body._auto_corrected = true;
      }
    }

    next();
  } catch (error) {
    console.error('NutritionValidator error:', error);

    // Don't block the request on validation failure
    req.validated_nutrition = {
      validated: null,
      input: req.body,
      usda_data: null,
      discrepancies: [],
      corrections: null,
      confidence: 0,
      recommendation: 'Validation failed - proceeding with original values',
    };

    next();
  }
};

/**
 * Standalone validation function for use outside middleware
 */
export const validateNutrition = async (
  nutritionData: NutritionInput
): Promise<ValidationResult> => {
  const mockReq = { body: nutritionData } as Request;
  const mockRes = {} as Response;

  return new Promise((resolve, reject) => {
    nutritionValidator(mockReq, mockRes, (err) => {
      if (err) reject(err);
      else resolve(mockReq.validated_nutrition!);
    });
  });
};

export default nutritionValidator;
