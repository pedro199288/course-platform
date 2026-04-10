import type { RichTextDoc, RichTextMark, RichTextNode } from "./types.ts";
import { isRichTextDoc } from "./types.ts";

// Renders Tiptap-compatible JSON to an HTML string. This runs on both server
// and client without needing a DOM implementation, so it can be used from
// server routes, SSR rendering, and tests equally.

const SELF_CLOSING = new Set(["hardBreak", "horizontalRule"]);

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(text: string): string {
  return escapeHtml(text);
}

// Only allow http/https/mailto links so rendered output can't execute
// javascript: URIs copied in from an untrusted source.
function sanitizeHref(href: string): string {
  const trimmed = href.trim();
  if (/^(https?:|mailto:|\/|#)/i.test(trimmed)) return trimmed;
  return "#";
}

function renderMarks(text: string, marks: RichTextMark[] | undefined): string {
  let out = escapeHtml(text);
  if (!marks || marks.length === 0) return out;

  // Wrap from innermost to outermost. Order doesn't affect semantics because
  // each mark is independent, but we apply a stable order so output is
  // deterministic.
  const ordered = [...marks].sort((a, b) => a.type.localeCompare(b.type));
  for (const mark of ordered) {
    switch (mark.type) {
      case "bold":
        out = `<strong>${out}</strong>`;
        break;
      case "italic":
        out = `<em>${out}</em>`;
        break;
      case "code":
        out = `<code>${out}</code>`;
        break;
      case "link": {
        const href = sanitizeHref(mark.attrs.href);
        const target = mark.attrs.target ? ` target="${escapeAttr(mark.attrs.target)}"` : "";
        const rel = mark.attrs.rel ? ` rel="${escapeAttr(mark.attrs.rel)}"` : "";
        out = `<a href="${escapeAttr(href)}"${target}${rel}>${out}</a>`;
        break;
      }
    }
  }
  return out;
}

function renderNode(node: RichTextNode): string {
  switch (node.type) {
    case "text":
      return renderMarks(node.text, node.marks);
    case "hardBreak":
      return "<br />";
    case "horizontalRule":
      return "<hr />";
    case "paragraph":
      return `<p>${renderChildren(node.content)}</p>`;
    case "heading": {
      const level = Math.min(6, Math.max(1, node.attrs.level));
      return `<h${level}>${renderChildren(node.content)}</h${level}>`;
    }
    case "bulletList":
      return `<ul>${renderChildren(node.content)}</ul>`;
    case "orderedList": {
      const start =
        node.attrs?.start && node.attrs.start !== 1 ? ` start="${node.attrs.start}"` : "";
      return `<ol${start}>${renderChildren(node.content)}</ol>`;
    }
    case "listItem":
      return `<li>${renderChildren(node.content)}</li>`;
    case "blockquote":
      return `<blockquote>${renderChildren(node.content)}</blockquote>`;
    case "codeBlock": {
      const language = node.attrs?.language;
      const classAttr = language ? ` class="language-${escapeAttr(language)}"` : "";
      // Code blocks only contain text nodes; render without marks so
      // backticks/asterisks inside a code sample stay verbatim.
      const text = (node.content ?? [])
        .map((child) => (child.type === "text" ? escapeHtml(child.text) : ""))
        .join("");
      return `<pre><code${classAttr}>${text}</code></pre>`;
    }
  }
  // Unknown node types are silently dropped to avoid breaking rendering on
  // content produced by a future editor version.
  return "";
}

function renderChildren(children: RichTextNode[] | undefined): string {
  if (!children) return "";
  return children.map(renderNode).join("");
}

export function renderRichTextToHtml(doc: RichTextDoc | null | undefined): string {
  if (!doc || !isRichTextDoc(doc)) return "";
  return renderChildren(doc.content);
}

// Plain text extraction — used for previews/search indexing. Strips all
// formatting and emits a single space between block-level nodes.
export function extractPlainText(doc: RichTextDoc | null | undefined): string {
  if (!doc || !isRichTextDoc(doc)) return "";
  const parts: string[] = [];
  const walk = (node: RichTextNode) => {
    if (node.type === "text") {
      parts.push(node.text);
      return;
    }
    if (node.type === "hardBreak") {
      parts.push("\n");
      return;
    }
    if (SELF_CLOSING.has(node.type)) return;
    const children = (node as { content?: RichTextNode[] }).content;
    if (children) {
      for (const child of children) walk(child);
      // Separate block-level nodes so words don't run together.
      parts.push(" ");
    }
  };
  for (const node of doc.content ?? []) walk(node);
  return parts.join("").replace(/\s+/g, " ").trim();
}
