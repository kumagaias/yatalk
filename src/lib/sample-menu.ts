export async function loadSampleMenuFile(): Promise<File> {
  const response = await fetch("/menu-ocr-sample.png");
  if (!response.ok) throw new Error("The sample menu could not be loaded. Choose another photo.");
  return new File([await response.blob()], "yatalk-menu-sample.png", { type: "image/png" });
}
