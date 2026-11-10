
"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";

import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";

import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  List,
  Heading2,
  Table as TableIcon,
  ImagePlus,
  Link as LinkIcon,
  Undo,
  Redo,
} from "lucide-react";

interface RichEditorProps {
  content: string;
  onChange: (html: string) => void;
  placeholder?: string;
}

export function RichEditor({
  content,
  onChange,
  placeholder = "Write a detailed explanation...",
}: RichEditorProps) {
  const editor = useEditor({
    immediatelyRender: false,

    extensions: [
      StarterKit,
      Underline,
      Link.configure({
        openOnClick: false,
      }),
      Image,
      Table.configure({
        resizable: true,
      }),
      TableRow,
      TableHeader,
      TableCell,
    ],

    content,

    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },

    editorProps: {
      attributes: {
        class: "tiptap-content",
        "data-placeholder": placeholder,
      },
    },
  });

  if (!editor) {
    return (
      <div className="rich-editor-loading">
        Loading editor…
      </div>
    );
  }

  const addImage = () => {
    const url = window.prompt(
      "Image URL (use an approved asset URL)"
    );

    if (url) {
      editor.chain().focus().setImage({ src: url }).run();
    }
  };

  const addLink = () => {
    const url = window.prompt("Link URL");

    if (url) {
      editor.chain().focus().setLink({ href: url }).run();
    }
  };

  const toolbarButtons = [
    {
      icon: Bold,
      action: () => editor.chain().focus().toggleBold().run(),
      active: editor.isActive("bold"),
      label: "Bold",
    },
    {
      icon: Italic,
      action: () => editor.chain().focus().toggleItalic().run(),
      active: editor.isActive("italic"),
      label: "Italic",
    },
    {
      icon: UnderlineIcon,
      action: () => editor.chain().focus().toggleUnderline().run(),
      active: editor.isActive("underline"),
      label: "Underline",
    },
    {
      icon: Heading2,
      action: () =>
        editor.chain().focus().toggleHeading({ level: 2 }).run(),
      active: editor.isActive("heading", { level: 2 }),
      label: "Heading",
    },
    {
      icon: List,
      action: () => editor.chain().focus().toggleBulletList().run(),
      active: editor.isActive("bulletList"),
      label: "Bullet list",
    },
    {
      icon: TableIcon,
      action: () =>
        editor
          .chain()
          .focus()
          .insertTable({
            rows: 2,
            cols: 2,
            withHeaderRow: true,
          })
          .run(),
      active: false,
      label: "Insert table",
    },
    {
      icon: ImagePlus,
      action: addImage,
      active: false,
      label: "Image",
    },
    {
      icon: LinkIcon,
      action: addLink,
      active: editor.isActive("link"),
      label: "Link",
    },
    {
      icon: Undo,
      action: () => editor.chain().focus().undo().run(),
      active: false,
      label: "Undo",
    },
    {
      icon: Redo,
      action: () => editor.chain().focus().redo().run(),
      active: false,
      label: "Redo",
    },
  ];

  return (
    <div className="rich-editor">
      <div className="editor-toolbar">
        {toolbarButtons.map((button, index) => {
          const Icon = button.icon;

          return (
            <button
              type="button"
              key={index}
              title={button.label}
              aria-label={button.label}
              className={
                button.active ? "tool-active" : ""
              }
              onClick={button.action}
            >
              <Icon size={15} />
            </button>
          );
        })}
      </div>

      <EditorContent editor={editor} />

      <div className="editor-foot">
        Rich text · Tables · Images · Inline formatting ·
        Add equations in the LaTeX field below
      </div>
    </div>
  );
}
