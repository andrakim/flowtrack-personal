"use client";

import { ReactNode, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import {
  Bold,
  Code2,
  Heading2,
  Italic,
  Link2,
  List as ListIcon,
  ListChecks,
  ListOrdered,
  Quote,
  Redo2,
  Strikethrough,
  Undo2,
} from "lucide-react";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeRichContent(content: string) {
  const trimmed = content.trim();
  if (!trimmed) return "<p></p>";
  if (/<(p|h[1-6]|ul|ol|blockquote|pre|div)\b/i.test(trimmed)) {
    return trimmed;
  }
  return trimmed
    .split(/\n{2,}/)
    .map(
      (paragraph) =>
        `<p>${escapeHtml(paragraph).replaceAll("\n", "<br>")}</p>`,
    )
    .join("");
}

function RichToolbarButton({
  label,
  active = false,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={active ? "rich-toolbar-button active" : "rich-toolbar-button"}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}

export default function RichTextEditor({
  name,
  defaultValue,
}: {
  name: string;
  defaultValue: string;
}) {
  const initialContent = normalizeRichContent(defaultValue);
  const [html, setHtml] = useState(initialContent);
  const [, setRevision] = useState(0);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        link: {
          openOnClick: false,
          autolink: true,
          defaultProtocol: "https",
        },
      }),
      Placeholder.configure({
        placeholder: "Начни писать — выделяй главное, создавай списки и задачи…",
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
    ],
    content: initialContent,
    immediatelyRender: false,
    onUpdate: ({ editor: activeEditor }) => {
      setHtml(activeEditor.getHTML());
      setRevision((value) => value + 1);
    },
    onSelectionUpdate: () => setRevision((value) => value + 1),
  });

  function updateLink() {
    if (!editor) return;
    const previous = String(editor.getAttributes("link").href ?? "");
    const href = window.prompt("Адрес ссылки", previous || "https://");
    if (href === null) return;
    if (!href.trim()) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor
      .chain()
      .focus()
      .extendMarkRange("link")
      .setLink({ href: href.trim() })
      .run();
  }

  return (
    <div className="rich-editor">
      <input type="hidden" name={name} value={html} />
      <div className="rich-toolbar" role="toolbar" aria-label="Форматирование">
        <div>
          <RichToolbarButton
            label="Жирный"
            active={editor?.isActive("bold")}
            disabled={!editor}
            onClick={() => editor?.chain().focus().toggleBold().run()}
          >
            <Bold size={16} />
          </RichToolbarButton>
          <RichToolbarButton
            label="Курсив"
            active={editor?.isActive("italic")}
            disabled={!editor}
            onClick={() => editor?.chain().focus().toggleItalic().run()}
          >
            <Italic size={16} />
          </RichToolbarButton>
          <RichToolbarButton
            label="Зачёркнутый"
            active={editor?.isActive("strike")}
            disabled={!editor}
            onClick={() => editor?.chain().focus().toggleStrike().run()}
          >
            <Strikethrough size={16} />
          </RichToolbarButton>
        </div>
        <div>
          <RichToolbarButton
            label="Подзаголовок"
            active={editor?.isActive("heading", { level: 2 })}
            disabled={!editor}
            onClick={() =>
              editor?.chain().focus().toggleHeading({ level: 2 }).run()
            }
          >
            <Heading2 size={16} />
          </RichToolbarButton>
          <RichToolbarButton
            label="Маркированный список"
            active={editor?.isActive("bulletList")}
            disabled={!editor}
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
          >
            <ListIcon size={16} />
          </RichToolbarButton>
          <RichToolbarButton
            label="Нумерованный список"
            active={editor?.isActive("orderedList")}
            disabled={!editor}
            onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          >
            <ListOrdered size={16} />
          </RichToolbarButton>
          <RichToolbarButton
            label="Список задач"
            active={editor?.isActive("taskList")}
            disabled={!editor}
            onClick={() => editor?.chain().focus().toggleTaskList().run()}
          >
            <ListChecks size={16} />
          </RichToolbarButton>
        </div>
        <div>
          <RichToolbarButton
            label="Цитата"
            active={editor?.isActive("blockquote")}
            disabled={!editor}
            onClick={() => editor?.chain().focus().toggleBlockquote().run()}
          >
            <Quote size={16} />
          </RichToolbarButton>
          <RichToolbarButton
            label="Блок кода"
            active={editor?.isActive("codeBlock")}
            disabled={!editor}
            onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
          >
            <Code2 size={16} />
          </RichToolbarButton>
          <RichToolbarButton
            label="Ссылка"
            active={editor?.isActive("link")}
            disabled={!editor}
            onClick={updateLink}
          >
            <Link2 size={16} />
          </RichToolbarButton>
        </div>
        <div className="rich-toolbar-history">
          <RichToolbarButton
            label="Отменить"
            disabled={!editor?.can().chain().focus().undo().run()}
            onClick={() => editor?.chain().focus().undo().run()}
          >
            <Undo2 size={16} />
          </RichToolbarButton>
          <RichToolbarButton
            label="Повторить"
            disabled={!editor?.can().chain().focus().redo().run()}
            onClick={() => editor?.chain().focus().redo().run()}
          >
            <Redo2 size={16} />
          </RichToolbarButton>
        </div>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
