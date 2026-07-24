import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  FAMILY_STATUS_LABELS,
  getDomiciliaryRecord,
  saveDomiciliaryRecord,
  type DomiciliaryRecord,
  type FamilyStatus,
} from "@/lib/demo-domiciliary";
import type { SocleContact } from "@/services/socleContactService";

/**
 * Fichier domiciliaire d'un contact personne — mode démo : les données
 * viennent de `lib/demo-domiciliary` (saisie navigateur ou mock), jamais du
 * référentiel ni de la base.
 */

const formSchema = z.object({
  usual_name: z.string().trim().max(200).optional(),
  birth_date: z.string().trim().optional(),
  death_date: z.string().trim().optional(),
  family_status: z.enum(["celibataire", "marie", "pacse", "divorce", "inconnu"]).optional().nullable(),
  marriage_date: z.string().trim().optional(),
  pacs_date: z.string().trim().optional(),
  nationality: z.string().trim().max(100).optional(),
  phone_2: z.string().trim().max(50).optional(),
  arrival_date: z.string().trim().optional(),
  departure_date: z.string().trim().optional(),
  address_number: z.string().trim().max(20).optional(),
  address_btq: z.string().trim().max(10).optional(),
  address_street: z.string().trim().max(200).optional(),
  address_building: z.string().trim().max(100).optional(),
  address_apartment: z.string().trim().max(100).optional(),
  address_complement: z.string().trim().max(200).optional(),
  address_postal_code: z.string().trim().max(20).optional(),
  address_city: z.string().trim().max(100).optional(),
});

type FormValues = z.infer<typeof formSchema>;

function recordToFormValues(record: DomiciliaryRecord): FormValues {
  return {
    usual_name: record.usual_name ?? "",
    birth_date: record.birth_date ?? "",
    death_date: record.death_date ?? "",
    family_status: record.family_status,
    marriage_date: record.marriage_date ?? "",
    pacs_date: record.pacs_date ?? "",
    nationality: record.nationality ?? "",
    phone_2: record.phone_2 ?? "",
    arrival_date: record.arrival_date ?? "",
    departure_date: record.departure_date ?? "",
    address_number: record.address_number ?? "",
    address_btq: record.address_btq ?? "",
    address_street: record.address_street ?? "",
    address_building: record.address_building ?? "",
    address_apartment: record.address_apartment ?? "",
    address_complement: record.address_complement ?? "",
    address_postal_code: record.address_postal_code ?? "",
    address_city: record.address_city ?? "",
  };
}

function formValuesToRecord(values: FormValues): DomiciliaryRecord {
  const status = values.family_status ?? null;
  return {
    usual_name: values.usual_name?.trim() || null,
    birth_date: values.birth_date?.trim() || null,
    death_date: values.death_date?.trim() || null,
    family_status: status,
    marriage_date: status === "marie" ? values.marriage_date?.trim() || null : null,
    pacs_date: status === "pacse" ? values.pacs_date?.trim() || null : null,
    nationality: values.nationality?.trim() || null,
    phone_2: values.phone_2?.trim() || null,
    arrival_date: values.arrival_date?.trim() || null,
    departure_date: values.departure_date?.trim() || null,
    address_number: values.address_number?.trim() || null,
    address_btq: values.address_btq?.trim() || null,
    address_street: values.address_street?.trim() || null,
    address_building: values.address_building?.trim() || null,
    address_apartment: values.address_apartment?.trim() || null,
    address_complement: values.address_complement?.trim() || null,
    address_postal_code: values.address_postal_code?.trim() || null,
    address_city: values.address_city?.trim() || null,
  };
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("fr-FR");
}

function InfoCell({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm">{value?.trim() || "—"}</div>
    </div>
  );
}

function DateField({
  control,
  name,
  label,
}: {
  control: ReturnType<typeof useForm<FormValues>>["control"];
  name: keyof FormValues;
  label: string;
}) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input type="date" {...field} value={(field.value as string) ?? ""} />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function TextField({
  control,
  name,
  label,
  placeholder,
}: {
  control: ReturnType<typeof useForm<FormValues>>["control"];
  name: keyof FormValues;
  label: string;
  placeholder?: string;
}) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input {...field} value={(field.value as string) ?? ""} placeholder={placeholder} />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export default function DomiciliaryFileCard({ contact }: { contact: SocleContact }) {
  const [record, setRecord] = useState<DomiciliaryRecord>(() => getDomiciliaryRecord(contact));
  const [editOpen, setEditOpen] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    values: recordToFormValues(record),
  });
  const familyStatus = form.watch("family_status");

  function handleSubmit(values: FormValues) {
    const next = formValuesToRecord(values);
    saveDomiciliaryRecord(contact.id, next);
    setRecord(next);
    setEditOpen(false);
    toast.success("Informations domiciliaires enregistrées");
  }

  const addressLine = [
    record.address_number,
    record.address_btq,
    record.address_street,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">Fichier domiciliaire</CardTitle>
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
            <Pencil className="h-4 w-4 mr-2" /> Modifier
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <InfoCell label="Nom usuel" value={record.usual_name} />
          <InfoCell label="Date de naissance" value={formatDate(record.birth_date)} />
          <InfoCell label="Date de décès" value={formatDate(record.death_date)} />
          <InfoCell
            label="Situation familiale"
            value={record.family_status ? FAMILY_STATUS_LABELS[record.family_status] : null}
          />
          {record.family_status === "marie" && (
            <InfoCell label="Date de mariage" value={formatDate(record.marriage_date)} />
          )}
          {record.family_status === "pacse" && (
            <InfoCell label="Date du Pacs" value={formatDate(record.pacs_date)} />
          )}
          <InfoCell label="Nationalité" value={record.nationality} />
          <InfoCell label="Téléphone 2" value={record.phone_2} />
          <InfoCell label="Date d'arrivée" value={formatDate(record.arrival_date)} />
          <InfoCell label="Date de départ" value={formatDate(record.departure_date)} />
        </div>
        <Separator />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <InfoCell label="Adresse" value={addressLine} />
          <InfoCell label="Bâtiment" value={record.address_building} />
          <InfoCell label="Appartement" value={record.address_apartment} />
          <InfoCell label="Complément" value={record.address_complement} />
          <InfoCell label="Code postal" value={record.address_postal_code} />
          <InfoCell label="Ville" value={record.address_city} />
        </div>
      </CardContent>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Fichier domiciliaire — {contact.display_name}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <TextField control={form.control} name="usual_name" label="Nom usuel" />
                <TextField control={form.control} name="nationality" label="Nationalité" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <DateField control={form.control} name="birth_date" label="Date de naissance" />
                <DateField control={form.control} name="death_date" label="Date de décès" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="family_status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Situation familiale</FormLabel>
                      <Select
                        value={field.value ?? undefined}
                        onValueChange={(v) => field.onChange(v as FamilyStatus)}
                      >
                        <FormControl>
                          <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {Object.entries(FAMILY_STATUS_LABELS).map(([value, label]) => (
                            <SelectItem key={value} value={value}>{label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {familyStatus === "marie" && (
                  <DateField control={form.control} name="marriage_date" label="Date de mariage" />
                )}
                {familyStatus === "pacse" && (
                  <DateField control={form.control} name="pacs_date" label="Date du Pacs" />
                )}
              </div>
              <div className="grid grid-cols-3 gap-3">
                <TextField control={form.control} name="phone_2" label="Téléphone 2" />
                <DateField control={form.control} name="arrival_date" label="Date d'arrivée" />
                <DateField control={form.control} name="departure_date" label="Date de départ" />
              </div>

              <Separator />

              <div className="grid grid-cols-4 gap-3">
                <TextField control={form.control} name="address_number" label="N°" />
                <TextField control={form.control} name="address_btq" label="Bis/Ter" />
                <div className="col-span-2">
                  <TextField control={form.control} name="address_street" label="Voie" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <TextField control={form.control} name="address_building" label="Bâtiment" />
                <TextField control={form.control} name="address_apartment" label="Appartement" />
                <TextField control={form.control} name="address_complement" label="Complément" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <TextField control={form.control} name="address_postal_code" label="Code postal" />
                <TextField control={form.control} name="address_city" label="Ville" />
              </div>

              <Button type="submit" className="w-full">Enregistrer</Button>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
