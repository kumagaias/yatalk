export function kioskApprovalQrUrl(kioskMode: boolean, approvalUrl: string | undefined): string | null {
  if (!kioskMode || !approvalUrl) return null;
  try {
    const url = new URL(approvalUrl);
    return url.protocol === "https:" && (url.hostname === "paypal.com" || url.hostname.endsWith(".paypal.com"))
      ? url.toString() : null;
  } catch {
    return null;
  }
}
