import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { useEffect } from "react";
import { Bold, Italic, List, ListOrdered, Link as LinkIcon, Heading2, Heading3, Undo, Redo } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  minHeight?: number;
}

function ToolbarBtn({
  active,
  onClick,
  disabled,
  children,
  label,
}: {
  active?: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  label: string;
}) {
  return (
    <Button
      type="button"
      variant={active ? "secondary" : "ghost"}
      size="sm"
      className="h-8 w-8 p-0"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
    >
      {children}
    </Button>
  );
}

function Toolbar({ editor, disabled }: { editor: Editor | null; disabled?: boolean }) {
  if (!editor) return null;
  const promptLink = () => {
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("URL du lien", prev ?? "https://");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };
  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b bg-muted/30 px-2 py-1">
      <ToolbarBtn label="Gras" active={editor.isActive("bold")} disabled={disabled} onClick={() => editor.chain().focus().toggleBold().run()}>
        <Bold className="h-4 w-4" />
      </ToolbarBtn>
      <ToolbarBtn label="Italique" active={editor.isActive("italic")} disabled={disabled} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <Italic className="h-4 w-4" />
      </ToolbarBtn>
      <span className="mx-1 h-5 w-px bg-border" />
      <ToolbarBtn label="Titre 2" active={editor.isActive("heading", { level: 2 })} disabled={disabled} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
        <Heading2 className="h-4 w-4" />
      </ToolbarBtn>
      <ToolbarBtn label="Titre 3" active={editor.isActive("heading", { level: 3 })} disabled={disabled} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
        <Heading3 className="h-4 w-4" />
      </ToolbarBtn>
      <span className="mx-1 h-5 w-px bg-border" />
      <ToolbarBtn label="Liste à puces" active={editor.isActive("bulletList")} disabled={disabled} onClick={() => editor.chain().focus().toggleBulletList().run()}>
        <List className="h-4 w-4" />
      </ToolbarBtn>
      <ToolbarBtn label="Liste numérotée" active={editor.isActive("orderedList")} disabled={disabled} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        <ListOrdered className="h-4 w-4" />
      </ToolbarBtn>
      <span className="mx-1 h-5 w-px bg-border" />
      <ToolbarBtn label="Lien" active={editor.isActive("link")} disabled={disabled} onClick={promptLink}>
        <LinkIcon className="h-4 w-4" />
      </ToolbarBtn>
      <span className="ml-auto flex items-center gap-0.5">
        <ToolbarBtn label="Annuler" disabled={disabled || !editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}>
          <Undo className="h-4 w-4" />
        </ToolbarBtn>
        <ToolbarBtn label="Rétablir" disabled={disabled || !editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}>
          <Redo className="h-4 w-4" />
        </ToolbarBtn>
      </span>
    </div>
  );
}

export function RichTextEditor({ value, onChange, placeholder, disabled, className, minHeight = 280 }: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] } }),
      Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { class: "text-primary underline" } }),
    ],
    content: value || "",
    editable: !disabled,
    editorProps: {
      attributes: {
        class: cn(
          "prose prose-sm max-w-none focus:outline-none px-4 py-3",
          "prose-headings:font-semibold prose-p:my-2",
        ),
        style: `min-height: ${minHeight}px;`,
      },
    },
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      onChange(html === "<p></p>" ? "" : html);
    },
  });

  // Sync external value changes (e.g. switching courier)
  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    const incoming = value || "";
    if (incoming !== current && !(incoming === "" && current === "<p></p>")) {
      editor.commands.setContent(incoming, { emitUpdate: false });
    }
  }, [value, editor]);

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!disabled);
  }, [disabled, editor]);

  return (
    <div className={cn("rounded-md border bg-background overflow-hidden flex flex-col", className)}>
      <Toolbar editor={editor} disabled={disabled} />
      <div className="relative flex-1 overflow-y-auto">
        <EditorContent editor={editor} />
        {!value && placeholder && (
          <div className="pointer-events-none absolute left-4 top-3 text-sm text-muted-foreground">
            {placeholder}
          </div>
        )}
      </div>
    </div>
  );
}

export default RichTextEditor;
