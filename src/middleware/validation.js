import { body, validationResult } from "express-validator";

/**
 * Middleware to handle validation results
 */
export const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      error: "Validation failed", 
      details: errors.array().map(err => ({ field: err.path, message: err.msg })) 
    });
  }
  next();
};

/**
 * Validation rules for various endpoints
 */
export const businessRules = [
  body("name").trim().notEmpty().withMessage("Business name is required").isLength({ max: 100 }),
];

export const staffRules = [
  body("businessId").trim().notEmpty().withMessage("Business ID is required"),
  body("mobileNumber").trim().notEmpty().withMessage("Mobile number is required").matches(/^\+?[1-9]\d{1,14}$/).withMessage("Invalid mobile number format"),
  body("name").trim().notEmpty().withMessage("Name is required").isLength({ max: 50 }),
  body("role").optional().isIn(["admin", "staff", "manager"]).withMessage("Invalid role"),
];

export const itemRules = [
  body("businessId").trim().notEmpty().withMessage("Business ID is required"),
  body("name").trim().notEmpty().withMessage("Item name is required").isLength({ max: 200 }),
  body("price").isFloat({ min: 0 }).withMessage("Price must be a positive number"),
  body("categoryId").optional().trim(),
  body("imageUrl").optional().custom(val => {
    const isUrl = /^https?:\/\//.test(val);
    const isBase64 = val.startsWith("data:image");
    if (isUrl || isBase64) return true;
    throw new Error("Image must be a valid URL or Base64 string");
  }),
];

export const billRules = [
  body("businessId").trim().notEmpty().withMessage("Business ID is required"),
  body("items").isArray({ min: 1 }).withMessage("Items must be an array with at least one item"),
  body("items.*.name").trim().notEmpty().withMessage("Item name is required"),
  body("items.*.price").isFloat({ min: 0 }).withMessage("Item price must be positive"),
  body("items.*.quantity").isFloat({ min: 0.001 }).withMessage("Item quantity must be positive"),
  body("total").isFloat({ min: 0 }).withMessage("Total must be a positive number"),
];

