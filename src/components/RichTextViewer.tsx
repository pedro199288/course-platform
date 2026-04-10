import type { LessonContent, RichTextDoc } from "#/lib/rich-text/types.ts";
import { isRichTextDoc } from "#/lib/rich-text/types.ts";
import { renderRichTextToHtml } from "#/lib/rich-text/render.ts";

type RichTextViewerProps = {
  content: LessonContent;
  className?: string;
};

const DEFAULT_CLASS =
  "prose prose-sm dark:prose-invert max-w-none text-neutral-900 dark:text-neutral-100";

// Accepts either the new Tiptap JSON format or the legacy `{ text: string }`
// shape so already-saved lessons keep rendering.
function normalizeContent(content: LessonContent): {
  doc: RichTextDoc | null;
  fallback: string | null;
} {
  if (!content) return { doc: null, fallback: null };
  if (isRichTextDoc(content)) return { doc: content, fallback: null };
  const legacy = (content as { text?: unknown }).text;
  if (typeof legacy === "string") return { doc: null, fallback: legacy };
  return { doc: null, fallback: null };
}

export function RichTextViewer({ content, className }: RichTextViewerProps) {
  const { doc, fallback } = normalizeContent(content);
  const classes = className ?? DEFAULT_CLASS;

  if (doc) {
    const html = renderRichTextToHtml(doc);
    if (!html) {
      return (
        <p className="text-sm italic text-neutral-500 dark:text-neutral-400">No content yet.</p>
      );
    }
    // renderRichTextToHtml escapes all user input, so dangerouslySetInnerHTML
    // is safe here.
    return <div className={classes} dangerouslySetInnerHTML={{ __html: html }} />;
  }

  if (fallback !== null) {
    return (
      <div className={classes}>
        {fallback.split("\n").map((line, i) => (
          // eslint-disable-next-line react/no-array-index-key
          <p key={i}>{line}</p>
        ))}
      </div>
    );
  }

  return <p className="text-sm italic text-neutral-500 dark:text-neutral-400">No content yet.</p>;
}
