import type { NextFunction, Request, Response } from "express";
import { DEFAULT_SHOP_ID, getShopById, getShopByOwnerAndSlug, getShopBySlug, type Db } from "./database.js";
import { ApiError } from "./errors.js";
import { ownerSlugSchema, shopSlugSchema } from "../shared/schemas.js";

export function requireShopSlug(db: Db, allowInactive = false) {
  return (request: Request, _response: Response, next: NextFunction): void => {
    const parsed = shopSlugSchema.safeParse(request.params.shopSlug);
    if (!parsed.success) {
      next(new ApiError(404, "shop_not_found", "The requested shop was not found."));
      return;
    }
    const shop = getShopBySlug(db, parsed.data);
    if (!shop || !allowInactive && shop.status !== "active") {
      next(new ApiError(404, "shop_not_found", "The requested shop was not found."));
      return;
    }
    request.shop = shop;
    next();
  };
}

export function requireOwnerShopSlug(db: Db, allowInactive = false) {
  return (request: Request, _response: Response, next: NextFunction): void => {
    const owner = ownerSlugSchema.safeParse(request.params.ownerSlug);
    const shopSlug = shopSlugSchema.safeParse(request.params.shopSlug);
    if (!owner.success || !shopSlug.success) {
      next(new ApiError(404, "shop_not_found", "The requested shop was not found."));
      return;
    }
    const shop = getShopByOwnerAndSlug(db, owner.data, shopSlug.data);
    if (!shop || !allowInactive && shop.status !== "active") {
      next(new ApiError(404, "shop_not_found", "The requested shop was not found."));
      return;
    }
    request.shop = shop;
    next();
  };
}

export function useDefaultShop(db: Db) {
  return (_request: Request, _response: Response, next: NextFunction): void => {
    const shop = getShopById(db, DEFAULT_SHOP_ID);
    if (!shop) {
      next(new ApiError(503, "shop_unavailable", "The demo shop is not available."));
      return;
    }
    _request.shop = shop;
    next();
  };
}
