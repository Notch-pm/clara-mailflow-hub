import { useRef, useEffect, useState } from "react";
import EmailEditor, { EditorRef } from "react-email-editor";
import { Button } from "@/components/ui/button";
import { Loader2, Save, X } from "lucide-react";

interface Props {
  initialDesign?: object | null;
  onSave: (html: string, design: object) => void;
  onClose: () => void;
  isSaving?: boolean;
}

const MERGE_TAGS = {
  date: { name: "Date du courrier", value: "{{date}}", sample: "3 mai 2026" },
  objet: { name: "Objet", value: "{{objet}}", sample: "Re: Votre demande" },
  contenu: { name: "Contenu du courrier", value: "{{contenu}}", sample: "<p>Corps du message...</p>" },
  expediteur: { name: "Expéditeur", value: "{{expediteur}}", sample: "Jean Dupont" },
  organisation: { name: "Organisation (nom)", value: "{{organisation}}", sample: "Mairie de Paris" },
  organisation_complete: {
    name: "Organisation (avec adresse)",
    value: "{{{organisation_complete}}}",
    sample: "<strong>Mairie de Paris</strong><br>1 rue de Rivoli<br>75001 Paris<br>Tél : 01 23 45 67 89",
  },
  service: { name: "Service (nom)", value: "{{service}}", sample: "Service État civil" },
  service_complete: {
    name: "Service (avec adresse)",
    value: "{{{service_complete}}}",
    sample: "<strong>Service État civil</strong><br>1 rue de Rivoli<br>75001 Paris<br>Tél : 01 23 45 67 89",
  },
};

const TOOLBAR_HEIGHT = 49; // px — barre du haut

export default function TemplateEditor({ initialDesign, onSave, onClose, isSaving }: Props) {
  const editorRef = useRef<EditorRef>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [editorHeight, setEditorHeight] = useState(600);

  useEffect(() => {
    function updateHeight() {
      if (containerRef.current) {
        setEditorHeight(containerRef.current.clientHeight - TOOLBAR_HEIGHT);
      }
    }
    updateHeight();
    const ro = new ResizeObserver(updateHeight);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  function handleReady() {
    if (initialDesign) {
      editorRef.current?.editor?.loadDesign(initialDesign as any);
    }
  }

  function handleSave() {
    editorRef.current?.editor?.exportHtml(({ html, design }) => {
      onSave(html, design as unknown as object);
    });
  }

  return (
    <div ref={containerRef} className="flex flex-col" style={{ height: "100%" }}>
      <div className="flex items-center justify-between px-4 py-2 border-b bg-background shrink-0" style={{ height: TOOLBAR_HEIGHT }}>
        <div className="text-sm font-medium">
          Éditeur de modèle — variables :{" "}
          <span className="font-mono text-xs text-muted-foreground">
            {"{{"} date {"}}"}  {"{{"} objet {"}}"}  {"{{"} contenu {"}}"}  {"{{"} expediteur {"}}"}  {"{{"} organisation {"}}"}
          </span>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={isSaving}>
            <X className="h-4 w-4 mr-1" />
            Annuler
          </Button>
          <Button size="sm" onClick={handleSave} disabled={isSaving}>
            {isSaving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
            Enregistrer
          </Button>
        </div>
      </div>

      <EmailEditor
        ref={editorRef}
        onReady={handleReady}
        style={{ height: editorHeight }}
        options={{
          locale: "fr-FR",
          mergeTags: MERGE_TAGS,
          appearance: {
            theme: "light",
            panels: { tools: { dock: "right" } },
          },
          features: {
            textEditor: { tables: true, emojis: false },
          },
        }}
      />
    </div>
  );
}
