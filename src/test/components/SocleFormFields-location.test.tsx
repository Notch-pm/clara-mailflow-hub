// Le formulaire d'une démarche portant un champ `location` (Socle 1.29.0) : le
// schéma RÉEL de « Signaler un problème dans l'espace public » (Rosny), qui
// s'ouvrait vide le 2026-09-23 faute de connaître ce type.
import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import "../mocks/supabase";
import { renderWithProviders } from "../utils/renderWithProviders";
import { SocleFormFields } from "@/components/courier/SocleDemandeForm";
import { parseFormSchema } from "@/lib/socle-form";
import type { AddressSuggestion } from "@/lib/adresse";

const SUGGESTION = {
  label: "1 Place de l'Église 93110 Rosny-sous-Bois",
  name: "1 Place de l'Église",
  postcode: "93110",
  city: "Rosny-sous-Bois",
  precision: "adresse",
  score: 0.9,
  lat: 48.8741,
  lon: 2.4867,
} as AddressSuggestion;

vi.mock("@/components/address/useAddressSuggestions", () => ({
  useAddressSuggestions: (query: string) => ({
    suggestions: query.length >= 3 ? [SUGGESTION] : [],
    isLoading: false,
    isError: false,
    isStale: false,
  }),
  useGeocode: () => ({ data: null }),
  browserPosition: vi.fn(),
  reverseGeocode: vi.fn(),
  reverseGeocodingAvailable: () => false,
}));
vi.mock("@/components/address/AddressMap", () => ({ AddressMap: () => null }));

const ROSNY_SCHEMA = parseFormSchema({
  version: 1,
  content: [
    { id: "ep-lieu", key: "intervention_lieu", help: "Où se situe le problème constaté ?", type: "location", label: "Lieu d'intervention", required: true },
    {
      id: "ep-type", key: "type_probleme", type: "select", label: "Type de problème", required: true,
      options: [{ label: "Mobilier urbain (banc, corbeille, abri)", value: "mobilier_urbain" }, { label: "Autre", value: "autre" }],
    },
    { id: "ep-desc", key: "description", type: "textarea", label: "Description", required: true },
    {
      id: "ep-photo", key: "photo", type: "attachment", label: "Photo", maxFiles: 3,
      documentTypeId: "353ab8c7-7627-4633-918b-3f80706aa7f5", acceptedFormats: ["jpg", "png"],
    },
  ],
});

/** Le formulaire est contrôlé : l'hôte garde les valeurs, comme CreateTicketDialog. */
function Host({ initial, onChange }: { initial: Record<string, unknown>; onChange: (id: string, v: unknown) => void }) {
  const [values, setValues] = useState(initial);
  return (
    <SocleFormFields
      schema={ROSNY_SCHEMA}
      values={values}
      onChange={(id, v) => {
        onChange(id, v);
        setValues((prev) => ({ ...prev, [id]: v }));
      }}
      attachments={{}}
      onToggleAttachment={vi.fn()}
      courierDocs={[]}
      orgId="org-1"
      courierId="courier-1"
      onNewDoc={vi.fn()}
    />
  );
}

function renderForm(values: Record<string, unknown> = {}) {
  const onChange = vi.fn();
  renderWithProviders(<Host initial={values} onChange={onChange} />);
  return onChange;
}

describe("SocleFormFields — champ `location`", () => {
  it("rend TOUT le formulaire, lieu d'intervention compris", () => {
    renderForm();
    expect(screen.getByLabelText(/Lieu d'intervention/)).toBeInTheDocument();
    expect(screen.getByText("Type de problème")).toBeInTheDocument();
    expect(screen.getByText("Description")).toBeInTheDocument();
    expect(screen.getByText("Photo")).toBeInTheDocument();
  });

  it("une proposition BAN retenue écrit la forme du contrat, avec SON point", () => {
    const onChange = renderForm();
    const input = screen.getByLabelText(/Lieu d'intervention/);
    fireEvent.change(input, { target: { value: "place de l'eglise" } });
    // La liste choisit sur mousedown (avant le blur du champ), pas au clic.
    fireEvent.mouseDown(screen.getByText(/1 Place de l.Église/));
    expect(onChange).toHaveBeenLastCalledWith("ep-lieu", {
      address: SUGGESTION.label,
      lat: SUGGESTION.lat,
      lon: SUGGESTION.lon,
      precision: "adresse",
      adjusted: false,
    });
  });

  it("une saisie libre part sans point", () => {
    const onChange = renderForm();
    const input = screen.getByLabelText(/Lieu d'intervention/);
    fireEvent.change(input, { target: { value: "Parvis de l'église" } });
    expect(onChange).toHaveBeenLastCalledWith("ep-lieu", {
      address: "Parvis de l'église",
      lat: null,
      lon: null,
      precision: null,
      adjusted: false,
    });
  });

  it("réaffiche l'adresse saisie telle quelle", () => {
    renderForm({ "ep-lieu": { address: "12 rue X ", lat: null, lon: null, precision: null, adjusted: false } });
    expect(screen.getByLabelText(/Lieu d'intervention/)).toHaveValue("12 rue X ");
  });
});
