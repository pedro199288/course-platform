// Tiptap-compatible rich text document shape. Content stored in the
// lessons.content jsonb column uses this format so it can round-trip through
// the editor without loss.

export type RichTextMarkType = "bold" | "italic" | "code" | "link";

export type RichTextMark =
  | { type: "bold" | "italic" | "code"; attrs?: Record<string, string | number | boolean | null> }
  | { type: "link"; attrs: { href: string; target?: string | null; rel?: string | null } };

export type RichTextNode =
  | { type: "text"; text: string; marks?: RichTextMark[] }
  | { type: "hardBreak" }
  | { type: "paragraph"; content?: RichTextNode[] }
  | { type: "heading"; attrs: { level: 1 | 2 | 3 | 4 | 5 | 6 }; content?: RichTextNode[] }
  | { type: "bulletList"; content?: RichTextNode[] }
  | { type: "orderedList"; attrs?: { start?: number }; content?: RichTextNode[] }
  | { type: "listItem"; content?: RichTextNode[] }
  | { type: "blockquote"; content?: RichTextNode[] }
  | { type: "codeBlock"; attrs?: { language?: string | null }; content?: RichTextNode[] }
  | { type: "horizontalRule" };

export type RichTextDoc = {
  type: "doc";
  content?: RichTextNode[];
};

// Quiz content shape: multiple-choice questions stored on quiz-type lessons.
export type QuizQuestion = {
  id: string;
  question: string;
  options: string[];
  correctOption: number; // index into options array
};

export type QuizContent = {
  type: "quiz";
  questions: QuizQuestion[];
};

export function isQuizContent(value: unknown): value is QuizContent {
  return (
    typeof value === "object" && value !== null && (value as { type?: unknown }).type === "quiz"
  );
}

// File content shape: metadata for downloadable file lessons.
export type FileContent = {
  type: "file";
  filename: string | null;
  contentType: string | null;
};

export function isFileContent(value: unknown): value is FileContent {
  return (
    typeof value === "object" && value !== null && (value as { type?: unknown }).type === "file"
  );
}

// Content stored on a lesson row. New rich text lessons store RichTextDoc.
// The legacy plain-text shape { text: string } is still accepted so existing
// rows keep working until they are edited.
export type LessonContent = RichTextDoc | { text: string } | QuizContent | FileContent | null;

export function isRichTextDoc(value: unknown): value is RichTextDoc {
  return (
    typeof value === "object" && value !== null && (value as { type?: unknown }).type === "doc"
  );
}

export function emptyRichTextDoc(): RichTextDoc {
  return { type: "doc", content: [{ type: "paragraph" }] };
}
