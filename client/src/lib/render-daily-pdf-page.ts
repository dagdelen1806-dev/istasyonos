const MAX_PDF_BYTES = 12 * 1024 * 1024;
const MAX_RENDER_PIXELS = 8_000_000;
const MAX_RENDER_EDGE = 10_000;
const MAX_RENDER_BYTES = 5 * 1024 * 1024;

export async function renderDailyPdfPage(
  sourceUrl: string,
  pageNumber: number
): Promise<{ base64: string; width: number; height: number }> {
  if (!Number.isSafeInteger(pageNumber) || pageNumber < 1 || pageNumber > 100)
    throw new Error("PDF sayfa numarası 1–100 arasında olmalı.");
  const response = await fetch(sourceUrl, { credentials: "include", cache: "no-store" });
  if (!response.ok) throw new Error("Kaynak PDF güvenli biçimde okunamadı.");
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength < 8 || bytes.byteLength > MAX_PDF_BYTES)
    throw new Error("PDF boyutu tarayıcı render sınırını aşıyor.");

  const pdfjs = await import("pdfjs-dist");
  const workerUrl = await import("pdfjs-dist/build/pdf.worker.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl.default;
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    enableXfa: false,
    disableAutoFetch: true,
  });
  const pdfDocument = await task.promise;
  let page: Awaited<ReturnType<typeof pdfDocument.getPage>> | undefined;
  let canvas: HTMLCanvasElement | undefined;
  try {
    if (pdfDocument.numPages > 100 || pageNumber > pdfDocument.numPages)
      throw new Error("PDF sayfa sayısı doğrulanamadı.");
    page = await pdfDocument.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(
      2,
      Math.sqrt(MAX_RENDER_PIXELS / (base.width * base.height)),
      MAX_RENDER_EDGE / base.width,
      MAX_RENDER_EDGE / base.height
    );
    const viewport = page.getViewport({ scale });
    const width = Math.max(1, Math.floor(viewport.width));
    const height = Math.max(1, Math.floor(viewport.height));
    if (width * height > MAX_RENDER_PIXELS || width > MAX_RENDER_EDGE || height > MAX_RENDER_EDGE)
      throw new Error("PDF sayfası güvenli görüntü boyutuna indirgenemedi.");
    canvas = globalThis.document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: false });
    if (!context) throw new Error("Tarayıcı canvas alanı kullanılamıyor.");
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas!.toBlob(value => value ? resolve(value) : reject(new Error("PDF sayfa görüntüsü üretilemedi.")), "image/png")
    );
    if (blob.size > MAX_RENDER_BYTES) throw new Error("Render edilen sayfa 5 MB OCR sınırını aşıyor.");
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("PDF sayfa görüntüsü okunamadı."));
      reader.readAsDataURL(blob);
    });
    const base64 = dataUrl.split(",", 2)[1];
    if (!base64) throw new Error("PDF sayfa görüntüsü kodlanamadı.");
    return { base64, width, height };
  } finally {
    page?.cleanup();
    if (canvas) { canvas.width = 0; canvas.height = 0; }
    await task.destroy();
  }
}
