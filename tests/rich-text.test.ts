import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { db } from "#/db/index.ts";
import { tenants, courses, modules, lessons } from "#/db/schema/index.ts";
import { emptyRichTextDoc, isRichTextDoc, type RichTextDoc } from "#/lib/rich-text/types.ts";
import { renderRichTextToHtml, extractPlainText } from "#/lib/rich-text/render.ts";

// A representative document that exercises every formatting feature the
// editor is required to support: headings, bold, italic, code blocks, lists
// and links.
const sampleDoc: RichTextDoc = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: "Welcome" }],
    },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "This lesson covers " },
        {
          type: "text",
          text: "rich text",
          marks: [{ type: "bold" }],
        },
        { type: "text", text: " and " },
        {
          type: "text",
          text: "formatting",
          marks: [{ type: "italic" }],
        },
        { type: "text", text: "." },
      ],
    },
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "Docs",
          marks: [
            {
              type: "link",
              attrs: { href: "https://example.com/docs", target: "_blank", rel: "noopener" },
            },
          ],
        },
      ],
    },
    {
      type: "codeBlock",
      attrs: { language: "ts" },
      content: [{ type: "text", text: "const answer = 42;" }],
    },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text: "first" }] }],
        },
        {
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text: "second" }] }],
        },
      ],
    },
  ],
};

describe("rich text content — render", () => {
  it("isRichTextDoc identifies Tiptap docs", () => {
    expect(isRichTextDoc(sampleDoc)).toBe(true);
    expect(isRichTextDoc({ text: "legacy" })).toBe(false);
    expect(isRichTextDoc(null)).toBe(false);
  });

  it("emptyRichTextDoc returns a valid doc with one paragraph", () => {
    const doc = emptyRichTextDoc();
    expect(doc.type).toBe("doc");
    expect(doc.content?.[0]?.type).toBe("paragraph");
  });

  it("renders every supported formatting element to HTML", () => {
    const html = renderRichTextToHtml(sampleDoc);

    expect(html).toContain("<h1>Welcome</h1>");
    expect(html).toContain("<strong>rich text</strong>");
    expect(html).toContain("<em>formatting</em>");
    expect(html).toContain('href="https://example.com/docs"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener"');
    expect(html).toContain('<pre><code class="language-ts">const answer = 42;</code></pre>');
    expect(html).toContain("<ul>");
    expect(html).toContain("<li><p>first</p></li>");
    expect(html).toContain("<li><p>second</p></li>");
  });

  it("escapes HTML special characters in text content", () => {
    const doc: RichTextDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "<script>alert('xss')</script>" }],
        },
      ],
    };
    const html = renderRichTextToHtml(doc);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&#39;xss&#39;");
  });

  it("blocks javascript: URIs in link hrefs", () => {
    const doc: RichTextDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "click me",
              marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
            },
          ],
        },
      ],
    };
    const html = renderRichTextToHtml(doc);
    expect(html).not.toContain("javascript:");
    expect(html).toContain('href="#"');
  });

  it("returns empty string for null or non-doc input", () => {
    expect(renderRichTextToHtml(null)).toBe("");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(renderRichTextToHtml({ text: "legacy" } as any)).toBe("");
  });

  it("extractPlainText strips formatting but keeps words", () => {
    const text = extractPlainText(sampleDoc);
    expect(text).toContain("Welcome");
    expect(text).toContain("rich text");
    expect(text).toContain("formatting");
    expect(text).toContain("const answer = 42;");
    expect(text).not.toContain("<");
  });
});

// Integration: persist a Tiptap doc through the lessons table and verify it
// comes back byte-for-byte, then renders to the same HTML.
describe("rich text content — database round-trip (edit → save → render)", () => {
  const ts = Date.now();
  let tenantId: string;
  let moduleId: string;

  beforeAll(async () => {
    const [tenant] = await db
      .insert(tenants)
      .values({ name: "Rich Text School", subdomain: `rt-school-${ts}` })
      .returning();
    tenantId = tenant.id;

    const [course] = await db
      .insert(courses)
      .values({
        tenantId,
        title: "Rich Text Course",
        slug: `rt-course-${ts}`,
      })
      .returning();

    const [mod] = await db
      .insert(modules)
      .values({ courseId: course.id, title: "Intro", position: 0 })
      .returning();
    moduleId = mod.id;
  });

  afterAll(async () => {
    await db.delete(courses).where(eq(courses.tenantId, tenantId));
    await db.delete(tenants).where(eq(tenants.id, tenantId));
  });

  it("saves and reads back a rich text lesson unchanged", async () => {
    const [lesson] = await db
      .insert(lessons)
      .values({
        moduleId,
        title: "Rich Lesson",
        type: "text",
        content: sampleDoc,
        position: 0,
      })
      .returning();

    const fetched = await db.query.lessons.findFirst({
      where: eq(lessons.id, lesson.id),
    });

    expect(fetched).toBeDefined();
    expect(fetched!.content).toEqual(sampleDoc);
    expect(isRichTextDoc(fetched!.content)).toBe(true);
  });

  it("renders the saved content to HTML matching the source doc", async () => {
    const [lesson] = await db
      .insert(lessons)
      .values({
        moduleId,
        title: "Render Lesson",
        type: "text",
        content: sampleDoc,
        position: 1,
      })
      .returning();

    const fetched = await db.query.lessons.findFirst({
      where: eq(lessons.id, lesson.id),
    });
    expect(fetched).toBeDefined();

    const htmlFromDb = renderRichTextToHtml(fetched!.content as RichTextDoc);
    const htmlFromSource = renderRichTextToHtml(sampleDoc);
    expect(htmlFromDb).toBe(htmlFromSource);
    expect(htmlFromDb).toContain("<h1>Welcome</h1>");
    expect(htmlFromDb).toContain("<strong>rich text</strong>");
  });

  it("edits a lesson's content in place and reads the new doc back", async () => {
    const [lesson] = await db
      .insert(lessons)
      .values({
        moduleId,
        title: "Editable Lesson",
        type: "text",
        content: emptyRichTextDoc(),
        position: 2,
      })
      .returning();

    const updatedDoc: RichTextDoc = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Updated" }],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Now with " },
            { type: "text", text: "code", marks: [{ type: "code" }] },
            { type: "text", text: "." },
          ],
        },
      ],
    };

    const [saved] = await db
      .update(lessons)
      .set({ content: updatedDoc })
      .where(eq(lessons.id, lesson.id))
      .returning();

    expect(saved.content).toEqual(updatedDoc);

    const fetched = await db.query.lessons.findFirst({
      where: eq(lessons.id, lesson.id),
    });
    expect(fetched!.content).toEqual(updatedDoc);

    const html = renderRichTextToHtml(fetched!.content as RichTextDoc);
    expect(html).toContain("<h2>Updated</h2>");
    expect(html).toContain("<code>code</code>");
  });

  it("keeps legacy { text } content renderable via the viewer's fallback path", async () => {
    // Existing rows predate the rich-text rollout — they should still load
    // without crashing render code that branches on isRichTextDoc.
    const legacyContent = { text: "Hello legacy students" };
    const [lesson] = await db
      .insert(lessons)
      .values({
        moduleId,
        title: "Legacy Lesson",
        type: "text",
        content: legacyContent,
        position: 3,
      })
      .returning();

    const fetched = await db.query.lessons.findFirst({
      where: eq(lessons.id, lesson.id),
    });
    expect(fetched!.content).toEqual(legacyContent);
    expect(isRichTextDoc(fetched!.content)).toBe(false);
    // The renderer treats anything that isn't a doc as empty, leaving the
    // viewer's fallback branch responsible for legacy display.
    expect(renderRichTextToHtml(fetched!.content as RichTextDoc)).toBe("");
  });
});
