// src/middleware/validation.ts
// Input validation middleware using express-validator
// OWASP Top 10: A03 Injection, A04 Insecure Design

import { body, param, query, validationResult } from "express-validator";
import { Request, Response, NextFunction } from "express";

/**
 * Validation error handler middleware
 * Returns 400 Bad Request with validation errors
 */
export function handleValidationErrors(req: Request, res: Response, next: NextFunction) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      ok: false,
      error: "Validation failed",
      details: errors.array(),
    });
  }
  next();
}

/**
 * Health metrics validation (age, weight, height, calories, macros)
 */
export const validateHealthMetrics = [
  body("age")
    .optional()
    .isInt({ min: 13, max: 120 })
    .withMessage("Age must be between 13 and 120 years"),

  body("weight")
    .optional()
    .isFloat({ min: 50, max: 700 })
    .withMessage("Weight must be between 50 and 700 lbs"),

  body("heightFeet")
    .optional()
    .isInt({ min: 3, max: 8 })
    .withMessage("Height feet must be between 3 and 8"),

  body("heightInches")
    .optional()
    .isInt({ min: 0, max: 11 })
    .withMessage("Height inches must be between 0 and 11"),

  body("caloriesIn")
    .optional()
    .isInt({ min: 0, max: 10000 })
    .withMessage("Calories in must be between 0 and 10,000"),

  body("caloriesOut")
    .optional()
    .isInt({ min: 0, max: 10000 })
    .withMessage("Calories out must be between 0 and 10,000"),

  handleValidationErrors,
];

/**
 * Meal validation (name, calories, macros)
 */
export const validateMeal = [
  body("name")
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage("Meal name must be between 1 and 200 characters")
    .matches(/^[a-zA-Z0-9 '\-,.()\/]+$/)
    .withMessage("Meal name contains invalid characters"),

  body("calories")
    .optional()
    .isInt({ min: 0, max: 10000 })
    .withMessage("Calories must be between 0 and 10,000"),

  body("protein")
    .optional()
    .isInt({ min: 0, max: 1000 })
    .withMessage("Protein must be between 0 and 1,000g"),

  body("carbs")
    .optional()
    .isInt({ min: 0, max: 1000 })
    .withMessage("Carbs must be between 0 and 1,000g"),

  body("fat")
    .optional()
    .isInt({ min: 0, max: 1000 })
    .withMessage("Fat must be between 0 and 1,000g"),

  handleValidationErrors,
];

/**
 * Restaurant name validation (for recommendations)
 */
export const validateRestaurantName = [
  body("restaurantName")
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage("Restaurant name must be between 2 and 100 characters")
    .matches(/^[a-zA-Z0-9 '\-&]+$/)
    .withMessage("Restaurant name contains invalid characters"),

  handleValidationErrors,
];

/**
 * Customer ID validation (param)
 */
export const validateCustomerId = [
  param("customerId")
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage("Customer ID is required"),

  handleValidationErrors,
];

/**
 * Email validation
 */
export const validateEmail = [
  body("email")
    .trim()
    .isEmail()
    .normalizeEmail()
    .withMessage("Valid email required"),

  handleValidationErrors,
];

/**
 * UUID validation (for IDs)
 */
export const validateUUID = [
  param("id")
    .isUUID()
    .withMessage("Valid UUID required"),

  handleValidationErrors,
];

/**
 * Numeric ID validation
 */
export const validateNumericId = [
  param("id")
    .isInt({ min: 1 })
    .withMessage("Valid numeric ID required"),

  handleValidationErrors,
];

/**
 * Date validation (YYYY-MM-DD format)
 */
export const validateDate = [
  query("date")
    .optional()
    .matches(/^\d{4}-\d{2}-\d{2}$/)
    .withMessage("Date must be in YYYY-MM-DD format")
    .custom((value) => {
      const date = new Date(value);
      if (isNaN(date.getTime())) {
        throw new Error("Invalid date");
      }
      return true;
    }),

  handleValidationErrors,
];

/**
 * Pagination validation
 */
export const validatePagination = [
  query("page")
    .optional()
    .isInt({ min: 1 })
    .withMessage("Page must be a positive integer"),

  query("limit")
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage("Limit must be between 1 and 100"),

  handleValidationErrors,
];

/**
 * General text sanitization (removes HTML tags, trims, limits length)
 */
export const sanitizeText = (maxLength: number = 1000) => [
  body()
    .customSanitizer((value) => {
      if (typeof value === "string") {
        // Remove HTML tags
        return value.replace(/<[^>]*>/g, "").trim().substring(0, maxLength);
      }
      return value;
    }),
];

export default {
  validateHealthMetrics,
  validateMeal,
  validateRestaurantName,
  validateCustomerId,
  validateEmail,
  validateUUID,
  validateNumericId,
  validateDate,
  validatePagination,
  handleValidationErrors,
  sanitizeText,
};
