import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, ArrowLeft, ChevronLeft, ChevronRight, Pencil, Plus, Users } from "lucide-react";
import { useOrganization } from "@/contexts/OrganizationContext";
import ConsentementsCard from "@/components/contacts/ConsentementsCard";
import ContactCouriersCard from "@/components/contacts/ContactCouriersCard";
import ContactDemandesCard from "@/components/contacts/ContactDemandesCard";
import ContactFormDialog from "@/components/contacts/ContactFormDialog";
import ContactInfoCard from "@/components/contacts/ContactInfoCard";
import ContactRelationsCard from "@/components/contacts/ContactRelationsCard";
import { buildContactColumns } from "@/components/contacts/contactColumns";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnToggle } from "@/components/data-table/data-table-column-toggle";
import { useDataTableInstance } from "@/components/data-table/use-data-table-instance";
import { FilterChips, FilterSection, ListActiveFilters, ListFilterButton } from "@/components/list/ListFilters";
import {
  ListDensityToggle,
  ListExportButton,
  ListFooter,
  ListMessage,
  ListPage,
  ListSearch,
  ListToolbar,
  ToolbarButton,
  ToolbarTooltip,
} from "@/components/list/ListPage";
import { useContactDetail } from "@/hooks/useContactDetail";
import { useContactsList } from "@/hooks/useContactsList";
import { CONTACT_CATEGORIES, CONTACT_CATEGORY_PLURAL_LABELS, type ContactCategory } from "@/lib/contact-categories";
import { pageSummary, type ContactStatusFilter } from "@/lib/contact-list";
import { isContactNotFound, SOCLE_CONTACT_TYPE_LABELS, type SocleContact, type SocleContactType } from "@/services/socleContactService";

/**
 * Annuaire des contacts — données servies par le référentiel Socle (source de
 * vérité). Clara n'affiche et ne modifie les fiches qu'à travers l'API du
 * Socle ; seuls les courriers liés (référence socle_contact_id) sont des
 * données Clara.
 */

// ── Fiche contact ───────────────────────────────────────────────────────────

function ContactDetail({ contactId }: { contactId: string }) {
  const { organizationId } = useOrganization();
  const navigate = useNavigate();
  const [editOpen, setEditOpen] = useState(false);
  const { contactQuery, contact, notFound, archiveMutation, applySaved } = useContactDetail(organizationId, contactId);

  if (notFound) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" onClick={() => navigate("/contacts")}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Retour aux contacts
        </Button>
        <Card>
          <CardContent className="py-10 text-center space-y-2">
            <p className="font-medium">Contact introuvable dans le référentiel</p>
            <p className="text-sm text-muted-foreground">
              La fiche a peut-être été supprimée du référentiel. Les courriers qui la référencent
              restent consultables ; vous pouvez dissocier le contact depuis chaque courrier.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <Button variant="ghost" onClick={() => navigate("/contacts")}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Retour aux contacts
        </Button>
        {contact && (
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setEditOpen(true)}>
              <Pencil className="h-4 w-4 mr-2" /> Modifier
            </Button>
            <Button
              variant="outline"
              onClick={() => archiveMutation.mutate(contact.status === "active")}
              disabled={archiveMutation.isPending}
            >
              {contact.status === "active" ? (
                <><Archive className="h-4 w-4 mr-2" /> Archiver</>
              ) : (
                <><ArchiveRestore className="h-4 w-4 mr-2" /> Restaurer</>
              )}
            </Button>
          </div>
        )}
      </div>

      {contactQuery.isLoading && <Card><CardContent className="py-10 text-center text-muted-foreground">Chargement…</CardContent></Card>}
      {contactQuery.isError && !isContactNotFound(contactQuery.error) && (
        <Card>
          <CardContent className="py-10 text-center text-destructive text-sm">
            {contactQuery.error instanceof Error ? contactQuery.error.message : "Erreur de chargement du contact"}
          </CardContent>
        </Card>
      )}

      {contact && (
        <>
          <ContactInfoCard contact={contact} />
          <ConsentementsCard organizationId={organizationId!} contact={contact} />
          <ContactRelationsCard organizationId={organizationId!} contact={contact} onUpdated={applySaved} />
          <ContactCouriersCard organizationId={organizationId!} contactId={contactId} />
          <ContactDemandesCard socleContactId={contact.id} />
          <ContactFormDialog
            organizationId={organizationId!}
            contact={contact}
            open={editOpen}
            onOpenChange={setEditOpen}
            onSaved={applySaved}
          />
        </>
      )}
    </div>
  );
}

// ── Liste des contacts ──────────────────────────────────────────────────────

function ContactsList() {
  const { organizationId } = useOrganization();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [tableInstance, onTableInstanceChange] = useDataTableInstance<SocleContact>();
  const list = useContactsList(organizationId);
  const { contactsQuery, contacts, page } = list;

  const columns = useMemo(() => buildContactColumns(list.statusFilter !== "active"), [list.statusFilter]);

  return (
    <ListPage>
      <ListToolbar
        icon={<Users className="text-primary" />}
        title="Contacts"
        primary={
          <ToolbarTooltip label="Nouveau contact" hideFromXl>
            <ToolbarButton
              primary
              icon={<Plus />}
              label="Nouveau contact"
              text="Nouveau"
              showLabel
              onClick={() => setCreateOpen(true)}
            />
          </ToolbarTooltip>
        }
      >
        <ListFilterButton title="Filtrer les contacts" activeCount={list.chips.length} onReset={list.resetFilters}>
          <FilterSection label="Recherche">
            <ListSearch
              value={list.search}
              onChange={list.setSearch}
              placeholder="Rechercher par nom…"
              focusOnOpen
            />
          </FilterSection>
          <FilterSection label="Type">
            <FilterChips
              options={Object.entries(SOCLE_CONTACT_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
              selected={list.typeFilter === "all" ? [] : [list.typeFilter]}
              onToggle={(v) => list.setTypeFilter(list.typeFilter === v ? "all" : (v as SocleContactType))}
            />
          </FilterSection>
          <FilterSection label="Catégorie">
            <FilterChips
              options={CONTACT_CATEGORIES.map((c) => ({ value: c, label: CONTACT_CATEGORY_PLURAL_LABELS[c] }))}
              selected={list.categoryFilter}
              onToggle={(v) => {
                const c = v as ContactCategory;
                list.setCategoryFilter(
                  list.categoryFilter.includes(c) ? list.categoryFilter.filter((x) => x !== c) : [...list.categoryFilter, c],
                );
              }}
            />
          </FilterSection>
          <FilterSection label="Statut">
            <FilterChips
              options={[
                { value: "active", label: "Actifs" },
                { value: "archived", label: "Archivés" },
                { value: "all", label: "Tous" },
              ]}
              selected={[list.statusFilter]}
              onToggle={(v) => list.setStatusFilter(v as ContactStatusFilter)}
            />
          </FilterSection>
        </ListFilterButton>
        <ListDensityToggle />
        {tableInstance && <DataTableColumnToggle table={tableInstance} />}
        <ListExportButton onClick={list.exportCsv} busy={list.exporting} />
      </ListToolbar>
      <ListActiveFilters chips={list.chips} onReset={list.resetFilters} />

      {contactsQuery.isError ? (
        <ListMessage className="text-destructive">
          {contactsQuery.error instanceof Error ? contactsQuery.error.message : "Erreur de chargement des contacts"}
        </ListMessage>
      ) : (
        <DataTable
          columns={columns}
          data={contacts}
          getRowId={(c) => c.id}
          isLoading={contactsQuery.isLoading}
          onRowClick={(c) => navigate(`/contacts/${c.id}`)}
          onTableInstanceChange={onTableInstanceChange}
          emptyMessage="Aucun contact."
          itemLabel="contact"
          // L'API du Socle ne trie pas : un tri local ne porterait que sur la page.
          sortable={false}
          resetScrollKey={page}
          footer={
            // L'API du Socle ne renvoie pas de total : on pagine « à l'aveugle »,
            // précédent / suivant, sans numéros de page.
            <ListFooter>
              <p aria-live="polite">{pageSummary(page, contacts.length, contactsQuery.isFetching)}</p>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 rounded-md px-2 text-xs shadow-none"
                  disabled={page === 0}
                  onClick={() => list.setPage((p) => p - 1)}
                >
                  <ChevronLeft className="h-3.5 w-3.5" /> Précédent
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 rounded-md px-2 text-xs shadow-none"
                  disabled={!list.hasNextPage}
                  onClick={() => list.setPage((p) => p + 1)}
                >
                  Suivant <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </ListFooter>
          }
        />
      )}

      <ContactFormDialog
        organizationId={organizationId!}
        contact={null}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSaved={(saved) => {
          qc.invalidateQueries({ queryKey: ["socle-contacts"] });
          navigate(`/contacts/${saved.id}`);
        }}
        onSelectExisting={(existing) => {
          setCreateOpen(false);
          navigate(`/contacts/${existing.id}`);
        }}
      />
    </ListPage>
  );
}

export default function Contacts() {
  const params = useParams<{ id?: string }>();
  return params.id ? <ContactDetail contactId={params.id} /> : <ContactsList />;
}
