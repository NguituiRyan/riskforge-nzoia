/**
 * Read an offer document in the browser and redact personal details before anything is sent to the AI.
 * The file never leaves the device: only the redacted text goes to /api/offer.
 *   PDF  - pdf.js (loaded only when a PDF is opened)
 *   DOCX - unzip, read word/document.xml
 *   DOC  - legacy binary Word: best-effort text recovery (Save as DOCX or PDF for full accuracy)
 *   TXT / CSV / MD - as is
 */
import { strFromU8, unzipSync } from "fflate";

export interface DocText {
  name: string;
  kind: "pdf" | "docx" | "doc" | "text";
  pages: number | null;
  text: string;
}

export const MAX_DOC_BYTES = 15 * 1024 * 1024;

export async function readDocument(file: File): Promise<DocText> {
  if (file.size > MAX_DOC_BYTES) throw new Error("File is over 15 MB");
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf" || file.type === "application/pdf") return readPdf(file);
  if (ext === "docx") return { name: file.name, kind: "docx", pages: null, text: readDocx(new Uint8Array(await file.arrayBuffer())) };
  if (ext === "doc") return { name: file.name, kind: "doc", pages: null, text: readLegacyDoc(new Uint8Array(await file.arrayBuffer())) };
  return { name: file.name, kind: "text", pages: null, text: await file.text() };
}

async function readPdf(file: File): Promise<DocText> {
  const [pdfjs, worker] = await Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?url")]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const content = await (await pdf.getPage(i)).getTextContent();
    let line = "";
    const lines: string[] = [];
    for (const item of content.items) {
      if (!("str" in item)) continue;
      line += item.str;
      if (item.hasEOL) {
        lines.push(line);
        line = "";
      }
    }
    if (line) lines.push(line);
    pages.push(lines.join("\n"));
  }
  if (!pages.join("").trim()) throw new Error("This PDF has no text layer (a scan?). Export it with text, or paste the text.");
  return { name: file.name, kind: "pdf", pages: pdf.numPages, text: pages.join("\n\n") };
}

const XML_ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" };

function readDocx(bytes: Uint8Array): string {
  const files = unzipSync(bytes, { filter: (f) => f.name === "word/document.xml" });
  const xml = files["word/document.xml"];
  if (!xml) throw new Error("Not a Word document (no word/document.xml)");
  return strFromU8(xml)
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<\/w:tc>/g, " | ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(amp|lt|gt|quot|apos);/g, (m) => XML_ENTITIES[m])
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** legacy .doc: Word keeps the text as UTF-16LE or 8-bit runs inside the binary; recover readable runs */
function readLegacyDoc(bytes: Uint8Array): string {
  const runs: string[] = [];
  const utf16 = new TextDecoder("utf-16le").decode(bytes);
  for (const m of utf16.matchAll(/[\p{L}\p{N}\p{P}\p{Zs}\r\n\t°²]{6,}/gu)) runs.push(m[0]);
  const text = runs.join("\n").replace(/\r/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (text.length < 200) throw new Error("Could not read this .doc file. Save it as .docx or PDF and try again.");
  return text;
}

// ---------- redaction ----------
export interface Redaction {
  text: string;
  counts: { emails: number; phones: number; names: number };
}

// a person's name: 2-3 capitalised words on one line (a line break ends it, so "Surname\nCompany Name" stays apart)
const NAME = String.raw`([A-Z][a-z]+(?:[ \t]+[A-Z][a-z]+){1,2})`;
const TITLE_NAME = new RegExp(String.raw`\b(?:Mr|Mrs|Ms|Miss|Dr|Eng|Prof)\.?[ \t]+([A-Z][a-z]+(?:[ \t]+[A-Z][a-z]+){0,2})`, "g");
const ROLE_NAME = new RegExp(String.raw`\b(?:Manager|Director|Executive|Officer|Chairman|Underwriter)[ \t]*:[ \t]*(?:(?:Mr|Mrs|Ms|Dr)\.?[ \t]+)?${NAME}`, "g");
const CONTACT_LABEL = /\b(?:PREPARED BY|CERTIFIED BY|PRINCIPAL CONTACT|BROKER CONTACT|CONTACT PERSON|ATTENTION|ATTN)\b[ \t]*:?/gi;
const NAME_AFTER_LABEL = new RegExp(String.raw`^\s*(?:(?:Mr|Mrs|Ms|Dr)\.?[ \t]+)?${NAME}`);
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const PHONE = /(?:\+\s?\d{1,3}[\s().-]*)?\(?\d{2,4}\)?[\s.-]?\d{3}[\s.-]?\d{3,4}\b/g;

/** remove emails, phone numbers and people's names (found after titles, roles and contact labels, then everywhere) */
export function redactPersonal(raw: string): Redaction {
  const names = new Set<string>();
  for (const re of [TITLE_NAME, ROLE_NAME]) for (const m of raw.matchAll(re)) names.add(m[1].trim());
  // contact labels are matched in any case; the name after them must be properly capitalised
  for (const m of raw.matchAll(CONTACT_LABEL)) {
    const after = raw.slice(m.index! + m[0].length, m.index! + m[0].length + 80).match(NAME_AFTER_LABEL);
    if (after) names.add(after[1].trim());
  }
  let emails = 0;
  let phones = 0;
  let text = raw.replace(EMAIL, () => (emails++, "[email]"));
  text = text.replace(PHONE, (m) => {
    const digits = m.replace(/\D/g, "");
    // phone-shaped only: 9-13 digits with a + or a leading 0 / 7; leaves sums like 948,000,000 and dates alone
    if (digits.length < 9 || digits.length > 13 || !/^\+|^\(?0|^\(?7/.test(m.trim())) return m;
    phones++;
    return "[phone]";
  });
  let nameHits = 0;
  // full names first, then each surname on its own (signatures, "Mr. Surname")
  const parts = [...names].sort((a, b) => b.length - a.length);
  const surnames = new Set(parts.map((n) => n.split(/\s+/).pop()!).filter((s) => s.length > 3));
  for (const n of [...parts, ...surnames]) {
    const re = new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
    text = text.replace(re, () => (nameHits++, "[name]"));
  }
  text = text.replace(/\b(?:Mr|Mrs|Ms|Miss|Dr)\.?\s+\[name\]/g, "[name]");
  return { text, counts: { emails, phones, names: nameHits } };
}
