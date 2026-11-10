import express, { Router } from "express";
import type { AppConfig } from "../config.js";
import { ApiError } from "../errors.js";
import { logStage } from "../logging.js";
import { createRateLimit, ipKey } from "../rate-limit.js";
import { requireExactOrigin } from "../security.js";
import { detectShopImageMimeType, MAX_SHOP_IMAGE_BYTES, type ShopImageStorage } from "../shop-image-storage.js";

export function shopImageRoutes(config: AppConfig, storage: ShopImageStorage | null, allowUpload: boolean): Router {
  const router = Router();
  const originOnly = requireExactOrigin(config);
  const uploadLimit = createRateLimit(5, 60 * 60_000, (request) => request.ownerUserId ?? ipKey(request));

  router.get("/", async (request, response) => {
    if (!storage || !request.shop) throw new ApiError(404, "shop_image_not_found", "This shop has no image yet.");
    try {
      const image = await storage.get(request.shop.id);
      if (!image) throw new ApiError(404, "shop_image_not_found", "This shop has no image yet.");
      response.setHeader("Content-Type", image.mimeType);
      response.setHeader("Cache-Control", "public, max-age=300");
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("Content-Disposition", "inline");
      response.send(image.data);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(503, "shop_image_unavailable", "The shop image could not be loaded.");
    }
  });

  if (allowUpload) {
    router.put("/", originOnly, uploadLimit, express.raw({ type: () => true, limit: MAX_SHOP_IMAGE_BYTES }), async (request, response) => {
      if (!storage || !request.shop) throw new ApiError(503, "shop_image_storage_unavailable", "Shop image storage is not configured.");
      const data = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
      if (!data.length) throw new ApiError(400, "invalid_shop_image", "Choose an image to upload.");
      const mimeType = detectShopImageMimeType(data);
      const declared = request.header("content-type")?.split(";")[0]?.trim();
      if (!mimeType || mimeType !== declared) throw new ApiError(415, "invalid_shop_image", "Use a valid JPEG, PNG, or WebP image.");
      logStage(request.requestId, "shop_image_upload", "start");
      try {
        await storage.put(request.shop.id, { data, mimeType });
        logStage(request.requestId, "shop_image_upload", "success");
        const ownerSlug = request.shop.ownerSlug;
        const shopSlug = request.shop.slug;
        response.status(200).json({ imageUrl: `/api/v1/owners/${encodeURIComponent(ownerSlug ?? "")}/shops/${encodeURIComponent(shopSlug)}/image` });
      } catch (error) {
        logStage(request.requestId, "shop_image_upload", "failure", error);
        throw new ApiError(503, "shop_image_storage_unavailable", "The shop image could not be saved. Please retry.");
      }
    });
  }

  return router;
}
