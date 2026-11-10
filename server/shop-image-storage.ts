export const MAX_SHOP_IMAGE_BYTES = 2 * 1024 * 1024;
export type ShopImageMimeType = "image/jpeg" | "image/png" | "image/webp";
export type StoredShopImage = { data: Buffer; mimeType: ShopImageMimeType };

export interface ShopImageStorage {
  put(shopId: string, image: StoredShopImage): Promise<void>;
  get(shopId: string): Promise<StoredShopImage | undefined>;
}

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function detectShopImageMimeType(data: Buffer): ShopImageMimeType | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.length >= 8 && data.subarray(0, 8).equals(pngSignature)) return "image/png";
  if (data.length >= 16 && data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP" &&
      ["VP8 ", "VP8L", "VP8X"].includes(data.toString("ascii", 12, 16))) return "image/webp";
  return null;
}

export class GoogleCloudShopImageStorage implements ShopImageStorage {
  private accessToken: { value: string; expiresAt: number } | null = null;

  constructor(private readonly bucket: string, private readonly fetcher: typeof fetch = fetch) {}

  async put(shopId: string, image: StoredShopImage): Promise<void> {
    const name = objectName(shopId);
    const url = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(this.bucket)}/o?uploadType=media&name=${encodeURIComponent(name)}`;
    const response = await this.fetcher(url, {
      method: "POST", headers: { Authorization: `Bearer ${await this.getAccessToken()}`, "Content-Type": image.mimeType },
      body: new Uint8Array(image.data), signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error("Shop image storage failed");
  }

  async get(shopId: string): Promise<StoredShopImage | undefined> {
    const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(this.bucket)}/o/${encodeURIComponent(objectName(shopId))}?alt=media`;
    const response = await this.fetcher(url, { headers: { Authorization: `Bearer ${await this.getAccessToken()}` }, signal: AbortSignal.timeout(10_000) });
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error("Shop image storage failed");
    const data = Buffer.from(await response.arrayBuffer());
    const detected = detectShopImageMimeType(data);
    if (!detected || detected !== response.headers.get("content-type")?.split(";")[0]?.trim()) return undefined;
    return { data, mimeType: detected };
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && this.accessToken.expiresAt > Date.now() + 60_000) return this.accessToken.value;
    const response = await this.fetcher("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", {
      headers: { "Metadata-Flavor": "Google" }, signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error("Google Cloud credentials are unavailable");
    const value = await response.json() as { access_token?: unknown; expires_in?: unknown };
    if (typeof value.access_token !== "string" || typeof value.expires_in !== "number") throw new Error("Google Cloud credentials are unavailable");
    this.accessToken = { value: value.access_token, expiresAt: Date.now() + value.expires_in * 1000 };
    return value.access_token;
  }
}

function objectName(shopId: string): string {
  if (!/^[a-z0-9-]{1,80}$/i.test(shopId)) throw new Error("Invalid shop image key");
  return `shops/${shopId}/cover`;
}
