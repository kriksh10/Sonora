import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";

GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

export async function extractFileText(file: File, signal?: AbortSignal): Promise<string> {
  if (file.size > 12 * 1024 * 1024) throw new Error(`${file.name} is larger than the 12 MB limit.`);
  signal?.throwIfAborted();
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith(".txt") || lowerName.endsWith(".md")) {
    const text = await file.text();
    signal?.throwIfAborted();
    if (text.includes("\0")) throw new Error("This is not a readable text file. Choose TXT or paste text.");
    return text;
  }
  if (lowerName.endsWith(".doc") || lowerName.endsWith(".docx")) {
    const response = await fetch(`${import.meta.env.BASE_URL}api/files/extract`, {
      method: "POST", credentials: "include", signal, headers: { "Content-Type": "application/octet-stream" }, body: file,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Word file could not be read. Try an unencrypted file or paste its text.");
    if (typeof result.text !== "string") throw new Error("Document reader returned an invalid response.");
    return result.text;
  }
  if (lowerName.endsWith(".pdf")) {
    const task = getDocument({ data: new Uint8Array(await file.arrayBuffer()), disableFontFace: true, enableXfa: false });
    const abort = () => { void task.destroy(); };
    signal?.addEventListener("abort", abort, { once: true });
    const pages: string[] = [];
    const timeout = setTimeout(abort, 15_000);
    try {
      signal?.throwIfAborted();
      const pdf = await task.promise;
      if (pdf.numPages > 100) throw new Error("PDF exceeds the 100-page limit. Upload only the relevant pages.");
      let length = 0;
      for (let n = 1; n <= pdf.numPages; n += 1) {
        signal?.throwIfAborted();
        const page = await pdf.getPage(n);
        const content = await page.getTextContent();
        const text = content.items.map((item) => ("str" in item ? item.str : "")).filter(Boolean).join(" ");
        length += text.length;
        if (length > 2_000_000) throw new Error("PDF text exceeds safe extraction limits. Use fewer pages.");
        pages.push(text); page.cleanup();
      }
      if (!pages.join("").trim()) throw new Error("No selectable text found. This PDF may be scanned/image-only; paste its text or upload a text-based file.");
      return pages.join("\n");
    } catch (error) {
      signal?.throwIfAborted();
      throw new Error(error instanceof Error && /limit|selectable|safe extraction/.test(error.message)
        ? error.message : "Could not read PDF. It may be password-protected, damaged or too complex. Use an unencrypted PDF or paste text.");
    } finally {
      clearTimeout(timeout); signal?.removeEventListener("abort", abort); await task.destroy();
    }
  }
  throw new Error("Choose a Word (.docx or .doc), PDF, TXT or Markdown file.");
}
