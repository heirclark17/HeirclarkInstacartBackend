// src/middleware/validateEnv.ts
import { z } from "zod";

/**
 * Environment variable validation schema.
 * Validates all required environment variables at startup.
 */
const envSchema = z.object({
  // Server
  PORT: z.string().default("3000"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  // Database
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  // OpenAI
  OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY is required"),
  OPENAI_MODEL: z.string().default("gpt-4.1-mini"),
  OPENAI_VISION_MODEL: z.string().default("gpt-4o-mini"),
  OPENAI_MACRO_MODEL: z.string().default("gpt-4.1-mini"),

  // Instacart (optional - warn if missing)
  INSTACART_API_KEY: z.string().optional(),
  INSTACART_BASE_URL: z.string().default("https://connect.instacart.com"),

  // Fitbit (optional - for OAuth)
  FITBIT_CLIENT_ID: z.string().optional(),
  FITBIT_CLIENT_SECRET: z.string().optional(),
  FITBIT_REDIRECT_URI: z.string().optional(),

  // Apple Health
  HC_APPLE_SYNC_SIGNING_SECRET: z.string().min(16, "HC_APPLE_SYNC_SIGNING_SECRET must be at least 16 characters"),
  HC_APPLE_LINK_CODE_TTL_MINUTES: z.string().default("10"),
  HC_APPLE_TOKEN_TTL_DAYS: z.string().default("365"),

  // JWT Authentication
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  JWT_EXPIRES_IN: z.string().default("7d"),

  // CORS
  ALLOWED_ORIGINS: z.string().optional(),

  // Rate limiting
  RATE_LIMIT_WINDOW_MS: z.string().default("60000"),
  RATE_LIMIT_MAX_REQUESTS: z.string().default("100"),

  // User defaults (configurable)
  DEFAULT_GOAL_WEIGHT_LBS: z.string().default("225"),
  DEFAULT_HYDRATION_TARGET_ML: z.string().default("3000"),
  DEFAULT_CALORIES_TARGET: z.string().default("2200"),
  DEFAULT_PROTEIN_TARGET: z.string().default("190"),
  DEFAULT_CARBS_TARGET: z.string().default("190"),
  DEFAULT_FAT_TARGET: z.string().default("60"),
});

export type Env = z.infer<typeof envSchema>;

let validatedEnv: Env | null = null;

/**
 * Validates environment variables at startup.
 * Throws an error if required variables are missing or invalid.
 * Logs warnings for optional but recommended variables.
 */
export function validateEnvironment(): Env {
  if (validatedEnv) return validatedEnv;

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error("Environment validation failed:");
    for (const error of result.error.errors) {
      console.error(`  - ${error.path.join(".")}: ${error.message}`);
    }
    throw new Error("Invalid environment configuration. See errors above.");
  }

  validatedEnv = result.data;

  // Warnings for optional but recommended variables
  const warnings: string[] = [];

  if (!validatedEnv.INSTACART_API_KEY) {
    warnings.push("INSTACART_API_KEY is not set - Instacart integration will not work");
  }

  if (!validatedEnv.FITBIT_CLIENT_ID || !validatedEnv.FITBIT_CLIENT_SECRET) {
    warnings.push("Fitbit OAuth credentials not set - Fitbit integration will not work");
  }

  if (warnings.length > 0) {
    console.warn("\nEnvironment warnings:");
    warnings.forEach((w) => console.warn(`  - ${w}`));
    console.warn("");
  }

  console.log("Environment validation passed");
  return validatedEnv;
}

/**
 * Get validated environment variables.
 * Must call validateEnvironment() first.
 */
export function getEnv(): Env {
  if (!validatedEnv) {
    throw new Error("Environment not validated. Call validateEnvironment() first.");
  }
  return validatedEnv;
}

export default validateEnvironment;
