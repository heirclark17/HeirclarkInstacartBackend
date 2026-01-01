/**
 * RAG Module Index
 * Exports all RAG-related services and types
 */

// Types
export * from './types';

// Services
export { default as ragService } from './ragService';
export {
  chunkText,
  embedText,
  embedTexts,
  upsertDocumentWithChunks,
  retrieveTopK,
  retrieveForMealEstimation,
  retrieveForSwaps,
  formatChunksForPrompt,
  getChunkCitations,
  isRetrievalStrong,
  logAiRequest,
  checkRagHealth,
} from './ragService';

export { default as topFoodsService } from './topFoodsService';
export {
  getTopFoods,
  getUserTopFoods,
  getGlobalTopFoods,
  refreshTopFoodsCache,
  getFallbackFoods,
  formatFoodsForRag,
} from './topFoodsService';

export { default as ragAiService } from './ragAiService';
export {
  estimateMealFromTextWithRag,
  estimateMealFromPhotoWithRag,
} from './ragAiService';
