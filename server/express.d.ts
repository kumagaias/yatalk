import type { VisitorSession } from "./security.js";
import type { Shop } from "./database.js";

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      visitorSession?: VisitorSession;
      shop?: Shop;
      ownerUserId?: string;
      ownerSlug?: string;
      ownerDisplayName?: string;
      ownerCurrency?: import("../shared/currency.js").CurrencyCode;
      shopRole?: "owner" | "staff";
      isOrganizer?: boolean;
    }
  }
}

export {};
