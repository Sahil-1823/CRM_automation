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
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return plainToMarkdown(text, title);
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

async function fromPdf(buffer, title) {
  const result = await pdfParse(buffer);
  return plainToMarkdown(result.text, title);
}

async function fromDocx(buffer, title) {
  const result = await mammoth.convertToHtml({ buffer });
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
