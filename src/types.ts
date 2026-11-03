export type AppConfig = {
  eventName: string;
  currency: string;
  paypalClientId: string | null;
  paypalEnabled: boolean;
};

export type Product = {
  id: string;
  name: string;
  description: string;
  priceMinor: number;
  currency: string;
  dietaryNote: string | null;
  available: number;
  stockOnHand?: number;
  reserved?: number;
};

export type MenuResponse = {
  event: string | { name?: string; status?: string };
  products: Product[];
  catalogRevision: number;
};

export type CartLine = {
  productId?: string;
  id?: string;
  name: string;
  quantity: number;
  unitPriceMinor?: number;
  priceMinor?: number;
  lineTotalMinor: number;
  available: number;
};

export type Cart = {
  items: CartLine[];
  totalMinor: number;
  currency: string;
  cartVersion: number;
  catalogRevision: number;
};

export type OrderState =
  | "creating_payment"
  | "pending_payment"
  | "create_unknown"
  | "capture_unknown"
  | "paid"
  | "collected"
  | "cancelled"
  | "expired"
  | "create_failed"
  | "refund_unknown"
  | "refunded";

export type Order = {
  orderId: string;
  state: OrderState;
  totalMinor: number;
  currency: string;
  pickupCode?: string | null;
  createdAt?: string;
  items?: Array<{ name: string; quantity: number }>;
  refundRestockRequested?: boolean | null;
};

export type OrganizerProduct = Product & {
  stockOnHand: number;
  reserved: number;
};

export type OrganizerSummary = {
  shop?: { slug: string; name: string; status: "active" | "inactive" };
  metrics: {
    grossSalesMinor: number;
    netSalesMinor: number;
    paidOrderCount: number;
    lowStockCount: number;
  };
  orders: Order[];
  products: OrganizerProduct[];
};

export type ApiCartResponse = Cart;

export type ChatResponse = {
  reply: string;
  clarification: string | null;
  cart: Cart;
};

export type CreateOrderResponse = {
  orderId: string;
  paypalOrderId?: string;
  state?: OrderState;
  expiresAt?: string;
  totalMinor?: number;
  currency?: string;
  pickupCode?: string | null;
};
