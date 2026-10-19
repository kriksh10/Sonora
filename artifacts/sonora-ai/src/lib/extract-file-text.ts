import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";

GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

export async function extractFileText(file: File): Promise<string> {
  if (file.size > 12 * 1024 * 1024) throw new Error(`${file.name} is larger than the 12 MB limit.`);
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith(".txt") || lowerName.endsWith(".md")) return file.text();
  if (lowerName.endsWith(".pdf") || file.type === "application/pdf") {
    const pdf = await getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const pages: string[] = [];
    for (let n = 1; n <= pdf.numPages; n += 1) {
      const content = await (await pdf.getPage(n)).getTextContent();
      pages.push(content.items.map((item) => ("str" in item ? item.str : "")).filter(Boolean).join(" "));
    }
    return pages.join("\n").slice(0, 40_000);
  }
  throw new Error("Choose a PDF, TXT, or Markdown file.");
}
