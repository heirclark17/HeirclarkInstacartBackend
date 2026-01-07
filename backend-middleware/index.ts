/**
 * Heirclark Backend Middleware
 *
 * Claude Skills + MCP integrated middleware for nutrition validation,
 * meal planning, and smart grocery suggestions.
 */

export { nutritionValidator, validateNutrition } from './nutrition-validator.middleware';
export { mealPersonalizer, generateMealPlan } from './meal-personalizer.middleware';
export { smartGrocery, analyzeGroceryNeeds } from './smart-grocery.middleware';

// Type exports
export type { } from './nutrition-validator.middleware';
export type { } from './meal-personalizer.middleware';
export type { } from './smart-grocery.middleware';
