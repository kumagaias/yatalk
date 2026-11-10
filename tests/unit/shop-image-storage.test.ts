import assert from "node:assert/strict";
import test from "node:test";
import { GoogleCloudShopImageStorage, detectShopImageMimeType } from "../../server/shop-image-storage.js";

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

test("shop image storage uses the runtime identity and reuses its token for private bucket access", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.startsWith("http://metadata.google.internal/")) {
      return Response.json({ access_token: "runtime-test-token", expires_in: 3600 });
    }
    if (url.includes("upload/storage/v1/")) return new Response(null, { status: 200 });
    return new Response(png, { status: 200, headers: { "content-type": "image/png" } });
  };
  const storage = new GoogleCloudShopImageStorage("private-shop-images", fetcher);

  await storage.put("shop-1", { data: png, mimeType: "image/png" });
  const image = await storage.get("shop-1");

  assert.deepEqual(image, { data: png, mimeType: "image/png" });
  assert.equal(calls.length, 3);
  assert.match(calls[0]!.url, /^http:\/\/metadata\.google\.internal\//);
  assert.equal(new Headers(calls[0]!.init?.headers).get("Metadata-Flavor"), "Google");
  assert.match(calls[1]!.url, /uploadType=media&name=shops%2Fshop-1%2Fcover/);
  assert.match(calls[2]!.url, /\/shops%2Fshop-1%2Fcover\?alt=media$/);
  assert.equal(new Headers(calls[1]!.init?.headers).get("Authorization"), "Bearer runtime-test-token");
  assert.equal(new Headers(calls[2]!.init?.headers).get("Authorization"), "Bearer runtime-test-token");
});

test("shop image storage ignores missing or mismatched image objects", async () => {
  let metadataCalls = 0;
  const fetcher: typeof fetch = async (input) => {
    if (String(input).startsWith("http://metadata.google.internal/")) {
      metadataCalls += 1;
      return Response.json({ access_token: "runtime-test-token", expires_in: 3600 });
    }
    return new Response(png, { status: 200, headers: { "content-type": "text/html" } });
  };
  const storage = new GoogleCloudShopImageStorage("private-shop-images", fetcher);

  assert.equal(await storage.get("shop-1"), undefined);
  assert.equal(metadataCalls, 1);
  assert.equal(detectShopImageMimeType(Buffer.from("<html>")), null);
  assert.equal(detectShopImageMimeType(Buffer.from("RIFF1234WEBPbad!")), null);
});
