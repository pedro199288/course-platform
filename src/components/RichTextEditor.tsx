import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { Link } from "@tiptap/extension-link";
import { useEffect } from "react";
import type { RichTextDoc } from "#/lib/rich-text/types.ts";
import { emptyRichTextDoc, isRichTextDoc } from "#/lib/rich-text/types.ts";

type RichTextEditorProps = {
  value: RichTextDoc | null;
  onChange: (doc: RichTextDoc) => void;
  placeholder?: string;
  id?: string;
  ariaLabel?: string;
};

// Shared extensions. Link is configured with safe defaults: external links
// open in new tabs with rel=noopener and only http(s)/mailto/relative URIs
// are allowed through the href input rule.
function buildExtensions() {
  return [
    StarterKit.configure({
      // StarterKit bundles its own link extension in v3, but we register ours
      // explicitly so we can customize autolink/target behavior.
      link: false,
    }),
    Link.configure({
      openOnClick: false,
      autolink: true,
      HTMLAttributes: {
        rel: "noopener noreferrer",
        target: "_blank",
      },
      protocols: ["http", "https", "mailto"],
    }),
  ];
}

function toolbarButtonClass(active: boolean): string {
  return [
    "rounded px-2 py-1 text-xs font-medium transition",
    active
      ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
      : "text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800",
  ].join(" ");
}

function Toolbar({ editor }: { editor: Editor }) {
  const promptForLink = () => {
    const previous = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", previous ?? "https://");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };

  return (
    <div
      className="flex flex-wrap items-center gap-1 border-b border-neutral-200 px-2 py-1.5 dark:border-neutral-800"
      role="toolbar"
      aria-label="Formatting"
    >
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleBold().run()}
        className={toolbarButtonClass(editor.isActive("bold"))}
        aria-pressed={editor.isActive("bold")}
        title="Bold"
      >
        B
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleItalic().run()}
        className={`${toolbarButtonClass(editor.isActive("italic"))} italic`}
        aria-pressed={editor.isActive("italic")}
        title="Italic"
      >
        I
      </button>
      <span className="mx-1 h-4 w-px bg-neutral-300 dark:bg-neutral-700" aria-hidden="true" />
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        className={toolbarButtonClass(editor.isActive("heading", { level: 1 }))}
        aria-pressed={editor.isActive("heading", { level: 1 })}
        title="Heading 1"
      >
        H1
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        className={toolbarButtonClass(editor.isActive("heading", { level: 2 }))}
        aria-pressed={editor.isActive("heading", { level: 2 })}
        title="Heading 2"
      >
        H2
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        className={toolbarButtonClass(editor.isActive("heading", { level: 3 }))}
        aria-pressed={editor.isActive("heading", { level: 3 })}
        title="Heading 3"
      >
        H3
      </button>
      <span className="mx-1 h-4 w-px bg-neutral-300 dark:bg-neutral-700" aria-hidden="true" />
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        className={toolbarButtonClass(editor.isActive("bulletList"))}
        aria-pressed={editor.isActive("bulletList")}
        title="Bullet list"
      >
        • List
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        className={toolbarButtonClass(editor.isActive("orderedList"))}
        aria-pressed={editor.isActive("orderedList")}
        title="Numbered list"
      >
        1. List
      </button>
      <span className="mx-1 h-4 w-px bg-neutral-300 dark:bg-neutral-700" aria-hidden="true" />
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        className={toolbarButtonClass(editor.isActive("codeBlock"))}
        aria-pressed={editor.isActive("codeBlock")}
        title="Code block"
      >
        {"</>"}
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        className={toolbarButtonClass(editor.isActive("blockquote"))}
        aria-pressed={editor.isActive("blockquote")}
        title="Quote"
      >
        &ldquo;
      </button>
      <button
        type="button"
        onClick={promptForLink}
        className={toolbarButtonClass(editor.isActive("link"))}
        aria-pressed={editor.isActive("link")}
        title="Link"
      >
        Link
      </button>
    </div>
  );
}

export function RichTextEditor({
  value,
  onChange,
  placeholder,
  id,
  ariaLabel,
}: RichTextEditorProps) {
  const initial = isRichTextDoc(value) ? value : emptyRichTextDoc();

  const editor = useEditor({
    extensions: buildExtensions(),
    content: initial,
    editorProps: {
      attributes: {
        class:
          "prose prose-sm dark:prose-invert max-w-none px-3 py-2 focus:outline-none min-h-[140px]",
        ...(id ? { id } : {}),
        ...(ariaLabel ? { "aria-label": ariaLabel } : {}),
        ...(placeholder ? { "data-placeholder": placeholder } : {}),
      },
    },
    onUpdate: ({ editor: e }) => {
      onChange(e.getJSON() as RichTextDoc);
    },
    // SSR: avoid hydration mismatch by rendering the empty editor until the
    // component mounts on the client.
    immediatelyRender: false,
  });

  // Keep the editor in sync if the parent resets `value` (e.g. after switching
  // between lessons without unmounting the component).
  useEffect(() => {
    if (!editor) return;
    const current = editor.getJSON();
    const next = isRichTextDoc(value) ? value : emptyRichTextDoc();
    if (JSON.stringify(current) !== JSON.stringify(next)) {
      editor.commands.setContent(next, { emitUpdate: false });
    }
  }, [editor, value]);

  return (
    <div className="rounded-md border border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-950">
      {editor ? <Toolbar editor={editor} /> : null}
      <EditorContent editor={editor} />
    </div>
  );
}
