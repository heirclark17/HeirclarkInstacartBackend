# NutritionValidator Skill

## Purpose
Cross-check AI-generated nutrition outputs against authoritative USDA data via OpenNutrition MCP to ensure accuracy and eliminate hallucinated macro values.

## Instructions

When given a food name and nutrition data (calories, protein, carbs, fat), perform the following:

1. **Query OpenNutrition MCP** with the food name to retrieve official USDA values
2. **Compare values** against the provided data:
   - Calories: Flag if difference > 10%
   - Protein: Flag if difference > 10%
   - Carbs: Flag if difference > 15%
   - Fat: Flag if difference > 10%
3. **Return validation result** with:
   - `validated: true/false`
   - `corrections: {}` if any values need adjustment
   - `confidence: number` (0-100) based on match quality
   - `usda_source: string` with FDC ID reference

## Validation Rules

- Always prefer USDA SR Legacy database for whole foods
- Use USDA Branded database for packaged products
- For restaurant items, use closest generic equivalent
- Round all values to 1 decimal place
- Include serving size normalization (per 100g standard)

## Response Format

```json
{
  "validated": boolean,
  "input": {
    "food_name": string,
    "calories": number,
    "protein_g": number,
    "carbs_g": number,
    "fat_g": number,
    "serving_size": string
  },
  "usda_data": {
    "food_name": string,
    "fdc_id": string,
    "calories": number,
    "protein_g": number,
    "carbs_g": number,
    "fat_g": number,
    "serving_size_g": number
  },
  "discrepancies": [
    {
      "field": string,
      "input_value": number,
      "usda_value": number,
      "difference_percent": number
    }
  ],
  "corrections": {
    "calories": number | null,
    "protein_g": number | null,
    "carbs_g": number | null,
    "fat_g": number | null
  },
  "confidence": number,
  "recommendation": string
}
```

## Error Handling

- If food not found in USDA database, return `validated: null` with suggestion for similar foods
- If multiple matches found, return top 3 with confidence scores
- Network errors should retry 3 times with exponential backoff
