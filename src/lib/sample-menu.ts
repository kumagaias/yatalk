export async function loadSampleMenuFile(): Promise<File> {
  const response = await fetch("/menu-ocr-sample.webp");
  if (!response.ok) throw new Error("The sample menu could not be loaded. Choose another photo.");
  return new File([await response.blob()], "yatalk-menu-sample.webp", { type: "image/webp" });
}
