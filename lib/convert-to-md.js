import path from "node:path";
import { createRequire } from "node:module";
import mammoth from "mammoth";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

const MAX_BYTES = 3 * 1024 * 1024; // 3 MB practical limit; uploads are base64 JSON over Vercel

function extOf(filename) {
  return path.extname(filename || "").toLowerCase();
}

function baseName(filename) {
  return path.basename(filename || "document", path.extname(filename || ""));
}

function plainToMarkdown(text, title) {
  const normalized = String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\t/g, " ")
    .trim();
  if (!normalized) return "";

  const lines = normalized.split("\n").map((l) => l.trimEnd());
  const body = lines.join("\n").trim();
  return title ? `# ${title}\n\n${body}` : body;
}

function htmlToMarkdown(html, title) {
  let text = String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    // Convert heading tags to markdown headings BEFORE stripping all tags
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n# $1\n")
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n## $1\n")
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n### $1\n")
    .replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, "\n#### $1\n")
    .replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, "\n##### $1\n")
    .replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, "\n###### $1\n")
    // Convert strong/bold to markdown bold so it survives tag stripping
    .replace(/<(strong|b)>([\s\S]*?)<\/(strong|b)>/gi, "**$2**")
    .replace(/<\/(p|div|li|tr)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  // If the HTML already produced markdown headings, don't prepend a duplicate title
  const hasHeadings = /^#{1,6} /m.test(text);
  return hasHeadings ? text : plainToMarkdown(text, title);
}

function csvToMarkdown(csv, title) {
  const lines = String(csv || "")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  if (!lines.length) return title ? `# ${title}\n` : "";

  const rows = lines.map((line) => line.split(",").map((c) => c.trim()));
  const header = `| ${rows[0].join(" | ")} |`;
  const sep = `| ${rows[0].map(() => "---").join(" | ")} |`;
  const body = rows.slice(1).map((r) => `| ${r.join(" | ")} |`).join("\n");
  const table = [header, sep, body].filter(Boolean).join("\n");
  return title ? `# ${title}\n\n${table}` : table;
}

/**
 * Heuristic: promote short, non-punctuated lines in PDF-extracted text to
 * markdown headings. PDF parsers lose heading structure, so we infer it from:
 *   - Line is short (< 70 chars)
 *   - Line does NOT end with sentence-ending punctuation
 *   - Line is preceded and/or followed by a blank line
 *   - Line is not all-lowercase (avoid promoting mid-sentence fragments)
 */
function detectPdfHeadings(text) {
  const lines = text.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const prev = i > 0 ? lines[i - 1].trim() : "";
    const next = i < lines.length - 1 ? lines[i + 1].trim() : "";

    const isShort = trimmed.length > 2 && trimmed.length < 70;
    const noEndPunct = !/[.!?,;:]$/.test(trimmed);
    const surroundedBySpace = (!prev || prev === "") || (!next || next === "");
    const notAllLower = trimmed !== trimmed.toLowerCase();
    const notNumber = !/^\d+\.?\s*$/.test(trimmed);

    if (isShort && noEndPunct && surroundedBySpace && notAllLower && notNumber) {
      out.push(`## ${trimmed}`);
    } else {
      out.push(line);
    }
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function fromPdf(buffer, title) {
  const result = await pdfParse(buffer);
  const withHeadings = detectPdfHeadings(result.text);
  // Use plainToMarkdown only if no headings were detected
  const hasHeadings = /^#{1,6} /m.test(withHeadings);
  return hasHeadings ? `# ${title}\n\n${withHeadings}` : plainToMarkdown(result.text, title);
}

async function fromDocx(buffer, title) {
  // Preserve heading styles from the Word document so chunkText can split on them
  const result = await mammoth.convertToHtml({
    buffer,
    styleMap: [
      "p[style-name='Heading 1'] => h1:fresh",
      "p[style-name='Heading 2'] => h2:fresh",
      "p[style-name='Heading 3'] => h3:fresh",
      "p[style-name='Heading 4'] => h4:fresh",
      "p[style-name='Heading 5'] => h5:fresh",
      "p[style-name='Heading 6'] => h6:fresh",
    ],
  });
  return htmlToMarkdown(result.value, title);
}

export function assertFileSize(buffer) {
  if (!buffer || buffer.length === 0) {
    throw new Error("Uploaded file is empty");
  }
  if (buffer.length > MAX_BYTES) {
    throw new Error(`File too large (max ${MAX_BYTES / 1024 / 1024} MB)`);
  }
}

export async function convertFileToMarkdown(buffer, filename) {
  assertFileSize(buffer);
  const ext = extOf(filename);
  const title = baseName(filename);

  let markdown = "";

  switch (ext) {
    case ".md":
    case ".markdown":
      markdown = buffer.toString("utf8").trim();
      if (!markdown.startsWith("# ")) {
        markdown = `# ${title}\n\n${markdown}`;
      }
      break;
    case ".txt":
      markdown = plainToMarkdown(buffer.toString("utf8"), title);
      break;
    case ".html":
    case ".htm":
      markdown = htmlToMarkdown(buffer.toString("utf8"), title);
      break;
    case ".csv":
      markdown = csvToMarkdown(buffer.toString("utf8"), title);
      break;
    case ".pdf":
      markdown = await fromPdf(buffer, title);
      break;
    case ".docx":
      markdown = await fromDocx(buffer, title);
      break;
    case ".doc":
      throw new Error(".doc files are not supported — save as .docx or .pdf");
    default:
      throw new Error(`Unsupported file type: ${ext || "unknown"}. Use .md, .txt, .pdf, .docx, .html, or .csv`);
  }

  if (!markdown.trim()) {
    throw new Error("Could not extract any text from this file");
  }

  return {
    markdown: markdown.trim(),
    sourceFilename: filename,
    sourceExt: ext || ".unknown",
  };
}

export const SUPPORTED_EXTENSIONS = [".md", ".markdown", ".txt", ".pdf", ".docx", ".html", ".htm", ".csv"];
