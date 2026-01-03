/**
 * RAG-Enhanced AI Service
 * Integrates RAG retrieval with LLM for improved meal estimation
 */

import OpenAI from 'openai';
import { z } from 'zod';
import {
  AiMealEstimate,
  AiMealEstimateSchema,
  RetrievedChunk,
  toLegacyFormat,
} from './types';
import {
  retrieveForMealEstimation,
  retrieveForSwaps,
  formatChunksForPrompt,
  getChunkCitations,
  isRetrievalStrong,
  logAiRequest,
} from './ragService';

// ============================================================================
// Configuration
// ============================================================================

const LLM_MODEL = process.env.LLM_MODEL || 'gpt-4.1-mini';
const MAX_RETRIES = 2;

// Initialize OpenAI client (optional - RAG AI won't work without it)
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const openai = OPENAI_API_KEY
  ? new OpenAI({ apiKey: OPENAI_API_KEY })
  : null;

// ============================================================================
// System Prompt
// ============================================================================

const SYSTEM_PROMPT = `You are a precise nutrition estimation assistant for the Heirclark app.

## Your Task
Estimate meal nutrition from text descriptions or photo analysis results.

## Response Format
Return ONLY valid JSON matching this exact schema:
{
  "meal_name": "string - descriptive name for the meal",
  "meal_time_of_day": "breakfast" | "lunch" | "dinner" | "snack" | "unknown",
  "what_i_see_on_the_plate": "string - detailed description of foods observed",
  "macros": {
    "calories": { "value": number } OR { "min": number, "max": number },
    "protein_g": { "value": number } OR { "min": number, "max": number },
    "carbs_g": { "value": number } OR { "min": number, "max": number },
    "fats_g": { "value": number } OR { "min": number, "max": number }
  },
  "foods": [
    {
      "name": "string",
      "portion": "string - e.g., '1 cup', '6 oz'",
      "portion_grams": number (optional),
      "calories": number,
      "protein": number,
      "carbs": number,
      "fat": number,
      "notes": "string (optional)",
      "confidence": number 0-100 (optional)
    }
  ],
  "confidence": number 0-100,
  "explanation": "string - why you estimated these values, cite sources",
  "explanation_sources": ["chunk_id_1", "chunk_id_2"],
  "healthier_swaps": [
    {
      "swap": "string - what to swap",
      "reason": "string - health benefit",
      "estimated_macro_impact": "string - e.g., '-50 cal, +5g protein'"
    }
  ],
  "follow_up_question": "string (optional) - ask if uncertain",
  "portion_notes": "string - how you estimated portions"
}

## Critical Rules
1. USE ONLY the provided knowledge base context for numeric macros
2. If context is insufficient: output RANGES (min/max) with lower confidence
3. If very uncertain: include follow_up_question AND use ranges
4. NEVER hallucinate precise macros without supporting context
5. Confidence scoring:
   - 80-100: Strong context match, clear portions
   - 60-79: Good context but some assumptions
   - 40-59: Limited context, estimated ranges
   - 0-39: Weak context, ask follow-up

## Portion Assumptions (when not specified)
- Protein portions: 4-6 oz (113-170g) cooked
- Rice/grains: 1 cup cooked (150-200g)
- Vegetables: 1 cup (100-150g)
- Oil/butter: 1 tbsp (14g)
- Cheese: 1 oz (28g)

Return ONLY the JSON object. No markdown, no explanation outside JSON.`;

// ============================================================================
// Main Estimation Function
// ============================================================================

/**
 * Estimate meal from text using RAG
 */
export async function estimateMealFromTextWithRag(
  text: string,
  options: {
    shopifyCustomerId?: string;
    localTimeIso?: string;
  } = {}
): Promise<{ estimate: AiMealEstimate; legacy: Record<string, unknown> }> {
  if (!openai) {
    throw new Error('OpenAI API key not configured - RAG AI estimation unavailable');
  }

  const startTime = Date.now();

  // Step 1: Retrieve relevant context
  const [mealChunks, swapChunks] = await Promise.all([
    retrieveForMealEstimation(text, 6),
    retrieveForSwaps(text, 3),
  ]);

  const allChunks = [...mealChunks, ...swapChunks];
  const context = formatChunksForPrompt(allChunks);
  const citations = getChunkCitations(allChunks);
  const strongRetrieval = isRetrievalStrong(mealChunks);

  // Step 2: Build prompt
  const userPrompt = buildUserPrompt(text, context, citations, strongRetrieval, options.localTimeIso);

  // Step 3: Call LLM
  let estimate: AiMealEstimate;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await openai.chat.completions.create({
        model: LLM_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3,
        max_tokens: 1500,
      });

      const content = response.choices[0]?.message?.content || '{}';
      const parsed = JSON.parse(content);

      // Validate with Zod
      estimate = AiMealEstimateSchema.parse(parsed);

      // Log the request
      const processingTimeMs = Date.now() - startTime;
      await logAiRequest({
        shopifyCustomerId: options.shopifyCustomerId,
        mode: 'meal_text',
        queryText: text,
        retrievedChunkIds: citations,
        llmModel: LLM_MODEL,
        llmResponse: estimate as unknown as Record<string, unknown>,
        confidence: estimate.confidence,
        processingTimeMs,
      });

      return {
        estimate,
        legacy: toLegacyFormat(estimate),
      };
    } catch (error) {
      lastError = error as Error;
      console.error(`[RAG-AI] Attempt ${attempt + 1} failed:`, error);

      if (attempt < MAX_RETRIES - 1) {
        // Retry with schema fix instruction
        continue;
      }
    }
  }

  // Return safe fallback on failure
  console.error('[RAG-AI] All attempts failed, returning safe fallback');
  const fallbackEstimate = createSafeFallback(text, citations);

  return {
    estimate: fallbackEstimate,
    legacy: toLegacyFormat(fallbackEstimate),
  };
}

/**
 * Estimate meal from photo analysis result using RAG
 */
export async function estimateMealFromPhotoWithRag(
  visionResult: {
    foods: string[];
    portions: string;
    clarity: number;
    description: string;
  },
  options: {
    shopifyCustomerId?: string;
    imageHash?: string;
  } = {}
): Promise<{ estimate: AiMealEstimate; legacy: Record<string, unknown> }> {
  if (!openai) {
    throw new Error('OpenAI API key not configured - RAG AI estimation unavailable');
  }

  const startTime = Date.now();

  // Build query from vision result
  const queryText = `${visionResult.foods.join(', ')}. ${visionResult.portions}`;

  // Step 1: Retrieve relevant context
  const [mealChunks, swapChunks] = await Promise.all([
    retrieveForMealEstimation(queryText, 6),
    retrieveForSwaps(queryText, 3),
  ]);

  const allChunks = [...mealChunks, ...swapChunks];
  const context = formatChunksForPrompt(allChunks);
  const citations = getChunkCitations(allChunks);
  const strongRetrieval = isRetrievalStrong(mealChunks);

  // Step 2: Build photo-specific prompt
  const userPrompt = buildPhotoPrompt(visionResult, context, citations, strongRetrieval);

  // Step 3: Call LLM
  let estimate: AiMealEstimate;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await openai.chat.completions.create({
        model: LLM_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3,
        max_tokens: 1500,
      });

      const content = response.choices[0]?.message?.content || '{}';
      const parsed = JSON.parse(content);

      estimate = AiMealEstimateSchema.parse(parsed);

      // Log the request
      const processingTimeMs = Date.now() - startTime;
      await logAiRequest({
        shopifyCustomerId: options.shopifyCustomerId,
        mode: 'meal_photo',
        queryText: queryText,
        imageHash: options.imageHash,
        retrievedChunkIds: citations,
        llmModel: LLM_MODEL,
        llmResponse: estimate as unknown as Record<string, unknown>,
        confidence: estimate.confidence,
        processingTimeMs,
      });

      return {
        estimate,
        legacy: toLegacyFormat(estimate),
      };
    } catch (error) {
      console.error(`[RAG-AI] Photo attempt ${attempt + 1} failed:`, error);
      if (attempt < MAX_RETRIES - 1) continue;
    }
  }

  // Return safe fallback
  const fallbackEstimate = createPhotoFallback(visionResult, citations);
  return {
    estimate: fallbackEstimate,
    legacy: toLegacyFormat(fallbackEstimate),
  };
}

// ============================================================================
// Prompt Building
// ============================================================================

function buildUserPrompt(
  text: string,
  context: string,
  citations: string[],
  strongRetrieval: boolean,
  localTimeIso?: string
): string {
  const timeOfDay = localTimeIso ? inferTimeOfDay(localTimeIso) : 'unknown';
  const confidenceHint = strongRetrieval
    ? 'Context is strong. Provide exact values if confident.'
    : 'Context is limited. Use ranges (min/max) and lower confidence. Consider asking a follow-up question.';

  return `## User's Meal Description
"${text}"

## Time Context
Local time suggests: ${timeOfDay}

## Knowledge Base Context (use for macro values)
${context}

## Available Citation IDs
${citations.join(', ') || 'none'}

## Confidence Guidance
${confidenceHint}

Analyze and return JSON response.`;
}

function buildPhotoPrompt(
  visionResult: {
    foods: string[];
    portions: string;
    clarity: number;
    description: string;
  },
  context: string,
  citations: string[],
  strongRetrieval: boolean
): string {
  const clarityNote = visionResult.clarity >= 70
    ? 'Photo clarity is good.'
    : visionResult.clarity >= 40
    ? 'Photo clarity is moderate. Some uncertainty in portions.'
    : 'Photo clarity is low. Use wider ranges for estimates.';

  const confidenceHint = strongRetrieval
    ? 'Context is strong for these foods.'
    : 'Context is limited. Use ranges and lower confidence.';

  return `## Photo Analysis Results
Foods detected: ${visionResult.foods.join(', ')}
Portions observed: ${visionResult.portions}
Description: ${visionResult.description}
Photo clarity: ${visionResult.clarity}%

${clarityNote}

## Knowledge Base Context (use for macro values)
${context}

## Available Citation IDs
${citations.join(', ') || 'none'}

## Confidence Guidance
${confidenceHint}

Analyze and return JSON response.`;
}

// ============================================================================
// Helpers
// ============================================================================

function inferTimeOfDay(localTimeIso: string): string {
  try {
    const date = new Date(localTimeIso);
    const hour = date.getHours();

    if (hour >= 5 && hour < 11) return 'breakfast';
    if (hour >= 11 && hour < 14) return 'lunch';
    if (hour >= 14 && hour < 17) return 'snack';
    if (hour >= 17 && hour < 21) return 'dinner';
    return 'snack';
  } catch {
    return 'unknown';
  }
}

function createSafeFallback(text: string, citations: string[]): AiMealEstimate {
  return {
    meal_name: text.slice(0, 50),
    meal_time_of_day: 'unknown',
    what_i_see_on_the_plate: text,
    macros: {
      calories: { min: 200, max: 600 },
      protein_g: { min: 10, max: 40 },
      carbs_g: { min: 20, max: 60 },
      fats_g: { min: 5, max: 25 },
    },
    confidence: 20,
    explanation: 'Unable to provide confident estimate. Values shown as wide ranges for safety.',
    explanation_sources: citations,
    follow_up_question: 'Could you describe the portion sizes and specific ingredients?',
    portion_notes: 'Unable to determine portions from description.',
  };
}

function createPhotoFallback(
  visionResult: { foods: string[]; description: string },
  citations: string[]
): AiMealEstimate {
  const mealName = visionResult.foods.slice(0, 3).join(', ') || 'Unknown Meal';

  return {
    meal_name: mealName,
    meal_time_of_day: 'unknown',
    what_i_see_on_the_plate: visionResult.description,
    macros: {
      calories: { min: 250, max: 700 },
      protein_g: { min: 15, max: 45 },
      carbs_g: { min: 25, max: 70 },
      fats_g: { min: 8, max: 30 },
    },
    confidence: 25,
    explanation: 'Photo analysis had limited clarity. Showing wide ranges for safety.',
    explanation_sources: citations,
    follow_up_question: 'What are the approximate portion sizes for each item?',
    portion_notes: 'Could not determine precise portions from photo.',
  };
}

export default {
  estimateMealFromTextWithRag,
  estimateMealFromPhotoWithRag,
};
