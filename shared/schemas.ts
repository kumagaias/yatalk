import { z } from "zod";

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

export const refundRequestSchema = z.object({
  restock: z.boolean(),
}).strict();

export const organizerQuestionSchema = z.object({
  question: z.string().trim().min(1).max(500),
}).strict();

export const shopSlugSchema = z.string().min(3).max(40)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers, and single hyphens")
  .refine((slug) => slug !== "new", "This shop address is reserved");

const shopFields = {
  name: z.string().trim().min(1).max(80),
  slug: shopSlugSchema,
} as const;

export const createShopRequestSchema = z.object({
  ...shopFields,
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(12).max(128),
}).strict();

export const addShopRequestSchema = z.object(shopFields).strict();

export const ownerLoginRequestSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(128),
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
export type RefundRequest = z.infer<typeof refundRequestSchema>;
export type OrganizerQuestionRequest = z.infer<typeof organizerQuestionSchema>;
