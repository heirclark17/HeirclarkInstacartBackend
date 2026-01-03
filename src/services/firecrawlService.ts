/**
 * Firecrawl Service - Web Scraping for Nutrition Data
 *
 * Scrapes recipes, nutrition info, and competitor data from the web.
 * Uses Firecrawl for scraping and OpenAI/Claude for structured extraction.
 */

import FirecrawlApp from '@mendable/firecrawl-js';
import OpenAI from 'openai';
import { pool } from '../db/pool';

// Types
export type ScrapeType = 'recipe' | 'nutrition' | 'competitor';

export interface ExtractedRecipe {
  title: string;
  description?: string;
  servings?: number;
  prepTime?: string;
  cookTime?: string;
  ingredients: Array<{
    name: string;
    amount: string;
    unit?: string;
  }>;
  macros: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    fiber?: number;
    sugar?: number;
    sodium?: number;
  };
  instructions: string[];
  tags?: string[];
  sourceUrl: string;
}

export interface ExtractedNutrition {
  foodName: string;
  servingSize: string;
  macros: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    fiber?: number;
    sugar?: number;
    sodium?: number;
  };
  vitamins?: Record<string, string>;
  minerals?: Record<string, string>;
  sourceUrl: string;
}

export interface ExtractedCompetitor {
  appName: string;
  features: string[];
  pricingTiers?: Array<{
    name: string;
    price: string;
    features: string[];
  }>;
  popularFoods?: Array<{
    name: string;
    calories?: number;
  }>;
  sourceUrl: string;
}

export interface ScrapeResult {
  id: string;
  url: string;
  type: ScrapeType;
  markdown: string;
  extractedData: ExtractedRecipe | ExtractedNutrition | ExtractedCompetitor;
  createdAt: Date;
}

// Initialize clients
const firecrawl = process.env.FIRECRAWL_API_KEY
  ? new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY })
  : null;

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

/**
 * Validate URL for scraping
 */
function validateUrl(url: string): { valid: boolean; error?: string } {
  try {
    const parsed = new URL(url);

    // Only allow http/https
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { valid: false, error: 'Only HTTP/HTTPS URLs are allowed' };
    }

    // Block internal/private IPs
    const blockedPatterns = [
      /^localhost$/i,
      /^127\./,
      /^10\./,
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
      /^192\.168\./,
      /^0\./,
    ];

    if (blockedPatterns.some(p => p.test(parsed.hostname))) {
      return { valid: false, error: 'Internal URLs are not allowed' };
    }

    return { valid: true };
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }
}

/**
 * Get extraction prompt based on scrape type
 */
function getExtractionPrompt(type: ScrapeType, url: string): string {
  const prompts: Record<ScrapeType, string> = {
    recipe: `Extract structured recipe data from this content. Return JSON with:
{
  "title": "Recipe name",
  "description": "Brief description",
  "servings": 4,
  "prepTime": "15 mins",
  "cookTime": "30 mins",
  "ingredients": [{"name": "ingredient", "amount": "1", "unit": "cup"}],
  "macros": {"calories": 350, "protein": 25, "carbs": 40, "fat": 12, "fiber": 5, "sugar": 8, "sodium": 400},
  "instructions": ["Step 1", "Step 2"],
  "tags": ["healthy", "quick"],
  "sourceUrl": "${url}"
}
If macros are not available, estimate based on ingredients. All numeric values should be numbers, not strings.`,

    nutrition: `Extract structured nutrition data from this content. Return JSON with:
{
  "foodName": "Food name",
  "servingSize": "1 cup (240g)",
  "macros": {"calories": 200, "protein": 10, "carbs": 25, "fat": 8, "fiber": 3, "sugar": 5, "sodium": 150},
  "vitamins": {"A": "10% DV", "C": "15% DV"},
  "minerals": {"Iron": "8% DV", "Calcium": "12% DV"},
  "sourceUrl": "${url}"
}
All numeric values should be numbers, not strings.`,

    competitor: `Extract competitor app/service data from this content. Return JSON with:
{
  "appName": "App name",
  "features": ["Feature 1", "Feature 2"],
  "pricingTiers": [{"name": "Free", "price": "$0", "features": ["Basic tracking"]}],
  "popularFoods": [{"name": "Food item", "calories": 200}],
  "sourceUrl": "${url}"
}`,
  };

  return prompts[type];
}

/**
 * Extract structured data from markdown using OpenAI
 */
async function extractWithLLM(
  markdown: string,
  type: ScrapeType,
  url: string
): Promise<ExtractedRecipe | ExtractedNutrition | ExtractedCompetitor> {
  if (!openai) {
    throw new Error('OpenAI API key not configured');
  }

  const prompt = getExtractionPrompt(type, url);

  // Truncate markdown if too long (keep first 15k chars)
  const truncatedMarkdown = markdown.length > 15000
    ? markdown.substring(0, 15000) + '\n\n[Content truncated...]'
    : markdown;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'You are a nutrition data extraction specialist. Extract structured data from web content and return valid JSON only. No markdown code blocks, just raw JSON.',
      },
      {
        role: 'user',
        content: `${prompt}\n\nContent to analyze:\n\n${truncatedMarkdown}`,
      },
    ],
    temperature: 0.2,
    max_tokens: 2000,
    response_format: { type: 'json_object' },
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('No response from LLM');
  }

  try {
    return JSON.parse(content);
  } catch (e) {
    console.error('Failed to parse LLM response:', content);
    throw new Error('Invalid JSON response from LLM');
  }
}

/**
 * Scrape a URL and extract structured nutrition data
 */
export async function scrapeAndExtract(
  url: string,
  type: ScrapeType
): Promise<ScrapeResult> {
  // Validate URL
  const validation = validateUrl(url);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  // Check if Firecrawl is configured
  if (!firecrawl) {
    throw new Error('Firecrawl API key not configured');
  }

  console.log(`[Firecrawl] Scraping ${type}: ${url}`);

  // Scrape the URL
  let scrapeResult;
  try {
    scrapeResult = await firecrawl.scrape(url, {
      formats: ['markdown'],
    });
  } catch (error: any) {
    // Handle rate limits
    if (error?.statusCode === 429) {
      throw new Error('Rate limit exceeded. Please try again later.');
    }
    throw new Error(`Failed to scrape URL: ${error.message}`);
  }

  if (!scrapeResult?.markdown) {
    throw new Error('Failed to extract content from URL');
  }

  const markdown = scrapeResult.markdown;

  // Extract structured data using LLM
  const extractedData = await extractWithLLM(markdown, type, url);

  // Save to database
  const id = crypto.randomUUID();
  const createdAt = new Date();

  await pool.query(
    `INSERT INTO nutrition_scrapes (id, url, type, markdown, extracted_json, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (url) DO UPDATE SET
       markdown = EXCLUDED.markdown,
       extracted_json = EXCLUDED.extracted_json,
       updated_at = NOW()`,
    [id, url, type, markdown, JSON.stringify(extractedData), createdAt]
  );

  console.log(`[Firecrawl] Successfully scraped and extracted: ${url}`);

  return {
    id,
    url,
    type,
    markdown,
    extractedData,
    createdAt,
  };
}

/**
 * Get cached scrape result if exists
 */
export async function getCachedScrape(url: string): Promise<ScrapeResult | null> {
  const result = await pool.query(
    `SELECT id, url, type, markdown, extracted_json, created_at
     FROM nutrition_scrapes
     WHERE url = $1
     AND created_at > NOW() - INTERVAL '7 days'`,
    [url]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    id: row.id,
    url: row.url,
    type: row.type,
    markdown: row.markdown,
    extractedData: row.extracted_json,
    createdAt: row.created_at,
  };
}

/**
 * Get recent scrapes by type
 */
export async function getRecentScrapes(
  type?: ScrapeType,
  limit: number = 20
): Promise<ScrapeResult[]> {
  const query = type
    ? `SELECT id, url, type, markdown, extracted_json, created_at
       FROM nutrition_scrapes
       WHERE type = $1
       ORDER BY created_at DESC
       LIMIT $2`
    : `SELECT id, url, type, markdown, extracted_json, created_at
       FROM nutrition_scrapes
       ORDER BY created_at DESC
       LIMIT $1`;

  const params = type ? [type, limit] : [limit];
  const result = await pool.query(query, params);

  return result.rows.map((row) => ({
    id: row.id,
    url: row.url,
    type: row.type,
    markdown: row.markdown,
    extractedData: row.extracted_json,
    createdAt: row.created_at,
  }));
}

/**
 * Batch scrape multiple URLs
 */
export async function batchScrape(
  urls: Array<{ url: string; type: ScrapeType }>
): Promise<Array<{ url: string; success: boolean; result?: ScrapeResult; error?: string }>> {
  const results = [];

  for (const { url, type } of urls) {
    try {
      // Check cache first
      const cached = await getCachedScrape(url);
      if (cached) {
        results.push({ url, success: true, result: cached });
        continue;
      }

      // Scrape with delay to avoid rate limits
      const result = await scrapeAndExtract(url, type);
      results.push({ url, success: true, result });

      // Small delay between requests
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (error: any) {
      results.push({ url, success: false, error: error.message });
    }
  }

  return results;
}

/**
 * Delete old scrapes (for data retention)
 */
export async function deleteOldScrapes(daysOld: number = 30): Promise<number> {
  const result = await pool.query(
    `DELETE FROM nutrition_scrapes
     WHERE created_at < NOW() - INTERVAL '1 day' * $1
     RETURNING id`,
    [daysOld]
  );

  return result.rowCount || 0;
}

/**
 * Check if Firecrawl service is configured and ready
 */
export function isConfigured(): boolean {
  return !!firecrawl && !!openai;
}

export default {
  scrapeAndExtract,
  getCachedScrape,
  getRecentScrapes,
  batchScrape,
  deleteOldScrapes,
  isConfigured,
};
