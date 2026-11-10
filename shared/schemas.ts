import { z } from "zod";
import { SUPPORTED_CURRENCIES } from "./currency.js";
import { MIN_FREE_OWNER_SLUG_LENGTH } from "./owner-limits.js";

const cartOperationFields = {
  action: z.enum(["add", "set", "remove"]),
  productId: z.string().min(1).max(80),
  quantity: z.number().int().min(0).max(20),
} as const;

function refineCartOperation(value: { action: "add" | "set" | "remove"; quantity: number }, ctx: z.RefinementCtx): void {
  if (value.action === "remove" && value.quantity !== 0) {
    ctx.addIssue({ code: "custom", message: "remove quantity must be 0", path: ["quantity"] });
  }
  if (value.action !== "remove" && value.quantity === 0) {
    ctx.addIssue({ code: "custom", message: "quantity must be 1-20", path: ["quantity"] });
  }
}

export const cartOperationSchema = z.object(cartOperationFields).strict().superRefine(refineCartOperation);

export const chatModelOutputSchema = z.object({
  reply: z.string().min(1).max(500),
  clarification: z.string().max(300).nullable(),
  operations: z.array(cartOperationSchema).max(12),
}).strict();

export const chatRequestSchema = z.object({
  message: z.string().trim().min(1).max(800),
  history: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().max(800),
  }).strict()).max(8),
  cartVersion: z.number().int().nonnegative(),
  catalogRevision: z.number().int().nonnegative(),
}).strict();

export const cartItemRequestSchema = z.object({
  action: z.enum(["add", "set", "remove"]),
  productId: z.string().min(1).max(80),
  quantity: z.number().int().min(0).max(20),
  cartVersion: z.number().int().nonnegative(),
  catalogRevision: z.number().int().nonnegative(),
}).strict().superRefine(refineCartOperation);

export const createOrderRequestSchema = z.object({
  cartVersion: z.number().int().nonnegative(),
  catalogRevision: z.number().int().nonnegative(),
  clientRequestKey: z.string().uuid(),
}).strict();

export const accessCodeRequestSchema = z.object({
  accessCode: z.string().refine((value) => {
    const length = Array.from(value).length;
    return length >= 16 && length <= 128;
  }, "Access code must contain 16-128 characters"),
}).strict();

export const productPatchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(240).optional(),
  priceMinor: z.number().int().min(1).max(1_000_000).optional(),
  stockOnHand: z.number().int().min(0).max(999).optional(),
  dietaryNote: z.string().trim().max(160).optional(),
  active: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one field is required");

export const receiveStockSchema = z.object({
  quantity: z.number().int().min(1).max(999),
  receiptId: z.string().uuid(),
}).strict();

export const createProductSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(240),
  priceMinor: z.number().int().min(1).max(1_000_000),
  stockOnHand: z.number().int().min(0).max(999),
  dietaryNote: z.string().trim().max(160),
}).strict();

export const createProductsRequestSchema = z.object({
  products: z.array(createProductSchema).min(1).max(30),
}).strict();

export const menuExtractionSchema = z.object({
  items: z.array(z.object({
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(240),
    priceMinor: z.number().int().min(1).max(1_000_000).nullable(),
    dietaryNote: z.string().trim().max(160),
  }).strict()).max(30),
}).strict();

export const refundRequestSchema = z.object({
  restock: z.boolean(),
}).strict();

export const organizerQuestionSchema = z.object({
  question: z.string().trim().min(1).max(500),
}).strict();

const menuDraftItemSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(240),
  priceMinor: z.number().int().min(1).max(1_000_000).nullable(),
  dietaryNote: z.string().trim().max(160),
}).strict();

export const menuAssistantRequestSchema = z.object({
  message: z.string().trim().min(1).max(800),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(800) }).strict()).max(8),
  draft: z.array(menuDraftItemSchema).max(30),
}).strict();

export const menuAssistantResponseSchema = z.object({
  reply: z.string().trim().min(1).max(500),
  suggestions: z.array(menuDraftItemSchema).max(12),
}).strict();

export const shopSlugSchema = z.string().min(3).max(40)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers, and single hyphens")
  .refine((slug) => slug !== "new", "This shop address is reserved");

const reservedOwnerSlugs = new Set(["api", "dashboard", "shops", "organizer", "owners", "new"]);
export const ownerSlugSchema = z.string().min(3).max(40)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers, and single hyphens")
  .refine((slug) => !reservedOwnerSlugs.has(slug), "This owner address is reserved");
export const ownerRegistrationSlugSchema = ownerSlugSchema.min(MIN_FREE_OWNER_SLUG_LENGTH, "Free owner addresses must contain at least 5 characters");
export const currencySchema = z.enum(SUPPORTED_CURRENCIES);

export const ownerRegistrationRequestSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  ownerSlug: ownerRegistrationSlugSchema,
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(12).max(128),
  defaultCurrency: currencySchema,
}).strict();

const shopFields = {
  name: z.string().trim().min(1).max(80),
  slug: shopSlugSchema,
} as const;

export const createShopRequestSchema = z.object(shopFields).strict();

export const addShopRequestSchema = z.object(shopFields).strict();

export const ownerLoginRequestSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(128),
}).strict();

export const passwordResetRequestSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
}).strict();

export const passwordResetCompleteSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  password: z.string().min(12).max(128),
}).strict();

export const emailVerificationTokenSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
}).strict();

export const paypalOrderCreateRequestSchema = z.object({
  intent: z.literal("CAPTURE"),
  purchase_units: z.array(z.object({
    reference_id: z.string(),
    custom_id: z.string(),
    invoice_id: z.string(),
    amount: z.object({
      currency_code: z.string(),
      value: z.string(),
    }).strict(),
    items: z.array(z.object({
      name: z.string(),
      quantity: z.string(),
      unit_amount: z.object({
        currency_code: z.string(),
        value: z.string(),
      }).strict(),
    }).strict()),
  }).strict()).length(1),
}).strict();

export type CartOperation = z.infer<typeof cartOperationSchema>;
export type ChatModelOutput = z.infer<typeof chatModelOutputSchema>;
export type ChatRequest = z.infer<typeof chatRequestSchema>;
export type CartItemRequest = z.infer<typeof cartItemRequestSchema>;
export type CreateOrderRequest = z.infer<typeof createOrderRequestSchema>;
export type ProductPatch = z.infer<typeof productPatchSchema>;
export type CreateProduct = z.infer<typeof createProductSchema>;
export type MenuExtraction = z.infer<typeof menuExtractionSchema>;
export type RefundRequest = z.infer<typeof refundRequestSchema>;
export type OrganizerQuestionRequest = z.infer<typeof organizerQuestionSchema>;
export type MenuAssistantRequest = z.infer<typeof menuAssistantRequestSchema>;
export type MenuAssistantResponse = z.infer<typeof menuAssistantResponseSchema>;
export type OwnerRegistrationRequest = z.infer<typeof ownerRegistrationRequestSchema>;
export type Currency = z.infer<typeof currencySchema>;
