// Envoi papier réel d'un courrier sortant par le prestataire (Merci Facteur).
//
// Point d'entrée unique, sans hypothèse sur l'appelant. Entrée :
//   { courier_id, organization_id, mode: "simple"|"suivi"|"recommande", document_id }
// `document_id` : le PDF de la lettre, déposé par l'écran dans les documents
// du courrier (l'exemplaire conservé est exactement ce qui part).
//
// Chaque appel réussi imprime, poste et FACTURE un courrier. D'où :
//   • réservation : une ligne `postal_sendings` active par courrier (index
//     unique partiel) — un double clic ou deux onglets n'envoient qu'une lettre ;
//   • `antidoublon` stable (`clara-<courier_id>`) : une issue inconnue (délai,
//     coupure) se rejoue sans risque, 3 tentatives au plus ;
//   • plafond quotidien par collectivité (`organizations.postal_daily_cap`) ;
//   • trace systématique : la ligne garde l'envoi_id, le prix ou l'erreur.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { assertEditor } from "../_shared/authz.ts";
import { canReadCourier } from "../_shared/courierAccess.ts";
import { contactsApiKeyForOrg, fetchContactsApi } from "../_shared/socleContactsClient.ts";
import { mfConfig, mfResolveUserId, mfSendAttempt, mfToken } from "../_shared/merciFacteur.ts";
import {
  bytesToBase64,
  decideOutcome,
  mfAntidoublon,
  normalizeMfAddress,
  resolveRecipientAddress,
  type ContactLike,
  type MfAttempt,
  type ParticipantLike,
  type PostalMode,
} from "../_shared/merciFacteurLogic.ts";

const BUCKET = "clara-documents";
const MAX_PDF_BYTES = 5 * 1024 * 1024;
const MODES: PostalMode[] = ["simple", "suivi", "recommande"];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-org-id, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const anon = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: userData, error: userErr } = await anon.auth.getUser(authHeader.replace("Bearer ", ""));
    if (userErr || !userData.user) return json({ error: "Unauthorized" }, 401);
    const userId = userData.user.id;

    const { courier_id, organization_id, mode, document_id } = await req.json().catch(() => ({}));
    if (!courier_id || !organization_id || !document_id || !MODES.includes(mode)) {
      return json({ error: "Paramètres manquants ou invalides (courier_id, organization_id, mode, document_id)." }, 400);
    }

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // ─── Droits ────────────────────────────────────────────────────────
    const { data: membership } = await admin
      .from("organization_users")
      .select("user_id")
      .eq("user_id", userId)
      .eq("organization_id", organization_id)
      .eq("is_active", true)
      .maybeSingle();
    if (!membership) return json({ error: "Accès refusé" }, 403);
    if (!(await assertEditor(admin, userId, organization_id))) {
      return json({ error: "Accès refusé : rôle consultant en lecture seule" }, 403);
    }
    if (!(await canReadCourier(authHeader, courier_id))) {
      return json({ error: "Courrier confidentiel : accès refusé" }, 403);
    }

    // ─── Collectivité : option, plafond, adresse d'expédition ─────────
    const { data: org, error: orgErr } = await admin
      .from("organizations")
      .select("name, socle_org_id, address_street, address_complement, address_postal_code, address_city, postal_sending_enabled, postal_daily_cap")
      .eq("id", organization_id)
      .single();
    if (orgErr || !org) return json({ error: "Collectivité introuvable." }, 404);
    if (!org.postal_sending_enabled) {
      return json({ error: "Les envois papiers réels ne sont pas activés pour votre collectivité (Paramètres → Envois papiers)." }, 403);
    }
    const cfg = mfConfig();
    if (!cfg) return json({ error: "Le prestataire d'envoi n'est pas configuré. Contactez Notch." }, 503);

    const since = new Date(Date.now() - 86_400_000).toISOString();
    const { count: dayCount } = await admin
      .from("postal_sendings")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organization_id)
      .gte("requested_at", since)
      .neq("status", "failed");
    if ((dayCount ?? 0) >= org.postal_daily_cap) {
      return json({ error: `Plafond atteint : ${org.postal_daily_cap} envois par le prestataire sur 24 heures. Réessayez plus tard ou relevez le plafond.` }, 429);
    }

    let exp;
    try {
      exp = normalizeMfAddress({
        societe: org.name,
        adresse1: org.address_street,
        adresse2: org.address_complement,
        cp: org.address_postal_code,
        ville: org.address_city,
        pays: "FRANCE",
      });
    } catch {
      return json({ error: "Adresse de la collectivité incomplète (rue, code postal, ville) : un administrateur doit la renseigner." }, 400);
    }

    // ─── Courrier ──────────────────────────────────────────────────────
    const { data: courier, error: cErr } = await admin
      .from("couriers")
      .select("id, organization_id, direction, channel, chrono, subject, metadata, parent_courier_id")
      .eq("id", courier_id)
      .eq("organization_id", organization_id)
      .single();
    if (cErr || !courier) return json({ error: "Courrier introuvable." }, 404);
    if (courier.direction !== "outbound") return json({ error: "Seul un courrier sortant s'envoie." }, 400);
    if (courier.channel !== "paper") return json({ error: "Ce courrier n'est pas en mode courrier postal." }, 400);
    const meta = (courier.metadata as Record<string, unknown> | null) ?? {};
    if (meta.posted_at) return json({ error: "Ce courrier est déjà déclaré posté." }, 409);

    const { data: doc } = await admin
      .from("courier_documents")
      .select("id, courier_id, organization_id, mime_type, file_size, storage_key, file_name")
      .eq("id", document_id)
      .eq("courier_id", courier_id)
      .eq("organization_id", organization_id)
      .maybeSingle();
    if (!doc?.storage_key) return json({ error: "Lettre PDF introuvable dans les documents du courrier." }, 400);
    if (doc.mime_type !== "application/pdf") return json({ error: "La lettre doit être un PDF." }, 400);

    // ─── Destinataire ──────────────────────────────────────────────────
    const partCols = "role, name, first_name, last_name, organization, address, metadata, socle_contact_id";
    const { data: ownParts } = await admin.from("courier_participants").select(partCols).eq("courier_id", courier.id);
    let participant = (ownParts ?? []).find((p) => p.role === "recipient") ?? null;
    if (!participant && courier.parent_courier_id) {
      const { data: parentParts } = await admin.from("courier_participants").select(partCols).eq("courier_id", courier.parent_courier_id);
      participant = (parentParts ?? []).find((p) => p.role === "sender") ?? null;
    }
    let contact: ContactLike | null = null;
    if (participant?.socle_contact_id) {
      try {
        const key = contactsApiKeyForOrg(org.socle_org_id);
        if (key) {
          const { body } = await fetchContactsApi(key, {
            method: "GET",
            path: `/v1/contacts/${participant.socle_contact_id}`,
            idempotent: true,
          }, { socleOrgId: org.socle_org_id });
          contact = (body as ContactLike | null) ?? null;
        }
      } catch (e) {
        console.warn("send-postal-letter: fiche du référentiel indisponible:", e);
      }
    }
    let dest;
    try {
      dest = resolveRecipientAddress(contact, participant as ParticipantLike | null, courier.chrono ?? "");
    } catch (e) {
      return json({ error: (e as Error).message }, 400);
    }

    // ─── PDF ───────────────────────────────────────────────────────────
    const { data: blob, error: dlErr } = await admin.storage.from(BUCKET).download(doc.storage_key);
    if (dlErr || !blob) return json({ error: "Lettre PDF illisible. Rien n'est parti." }, 502);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.byteLength > MAX_PDF_BYTES) return json({ error: "Lettre trop lourde pour l'envoi (5 Mo au plus)." }, 413);
    const pdfBase64 = bytesToBase64(bytes);

    // ─── Réservation ───────────────────────────────────────────────────
    const antidoublon = mfAntidoublon(courier.id);
    const { data: sending, error: resErr } = await admin
      .from("postal_sendings")
      .insert({
        organization_id,
        courier_id: courier.id,
        document_id: doc.id,
        mode,
        status: "pending",
        antidoublon,
        requested_by: userId,
      })
      .select("id")
      .single();
    if (resErr) {
      if ((resErr as { code?: string }).code === "23505") return json({ error: "Envoi déjà en cours ou déjà fait." }, 409);
      throw resErr;
    }

    // ─── Envoi ─────────────────────────────────────────────────────────
    const input = {
      idUser: "",
      exp,
      dest,
      pdfBase64,
      mode: mode as PostalMode,
      designation: [courier.chrono, courier.subject].filter(Boolean).join(" ") || null,
      finalFilename: courier.chrono ?? null,
      antidoublon,
    };
    const attempts: MfAttempt[] = [];
    try {
      let token = await mfToken(admin, cfg);
      // Avant tout envoi : une configuration fausse échoue ici, rien ne part.
      input.idUser = await mfResolveUserId(cfg, token);
      for (let i = 0; i < 3; i++) {
        const a = await mfSendAttempt(cfg, token, input);
        // Jeton refusé (réponse lisible, rien n'est parti) : un nouveau jeton, une fois.
        if (a.kind === "refused" && /token/i.test(a.error) && i === 0 && attempts.length === 0) {
          token = await mfToken(admin, cfg, true);
          continue;
        }
        attempts.push(a);
        if (a.kind !== "unknown") break;
        await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
      }
    } catch (e) {
      // Échec AVANT sendCourrier (jeton) : rien n'est parti, certitude.
      if (attempts.length === 0) attempts.push({ kind: "refused", error: (e as Error).message });
    }
    const outcome = decideOutcome(attempts.length ? attempts : [{ kind: "unknown", reason: "aucune tentative" }]);

    const anchorId = courier.parent_courier_id ?? courier.id;
    if (outcome.status !== "sent") {
      await admin.from("postal_sendings").update({ status: outcome.status, error: outcome.error.slice(0, 1000) }).eq("id", sending.id);
      await admin.from("courier_events").insert({
        organization_id,
        courier_id: anchorId,
        event_type: "outbound_postal_failed",
        payload: { reply_id: courier.id, mode, status: outcome.status, reason: outcome.error.slice(0, 300) },
        created_by: userId,
      } as never);
      return json({ error: outcome.error, status: outcome.status }, outcome.status === "failed" ? 502 : 504);
    }

    // ─── Parti : trace, déclaration « posté », historique ─────────────
    const sentAt = new Date().toISOString();
    await admin.from("postal_sendings").update({
      status: "sent",
      sent_at: sentAt,
      provider_envoi_id: outcome.ok.envoiId,
      price_ht: outcome.ok.priceHt,
      price_ttc: outcome.ok.priceTtc,
      nb_pages: outcome.ok.nbPages,
    }).eq("id", sending.id);

    const { error: postErr } = await admin
      .from("couriers")
      .update({
        metadata: {
          ...meta,
          posted_at: sentAt,
          posted_mode: mode,
          posted_by: userId,
          posted_document_id: doc.id,
          postal_provider: "merci_facteur",
          postal_sending_id: sending.id,
        },
      })
      .eq("id", courier.id)
      .eq("organization_id", organization_id);
    if (postErr) console.error("send-postal-letter: déclaration « posté » refusée après un envoi réussi:", postErr);

    const payload = {
      reply_id: courier.id,
      posted_on: sentAt,
      posted_mode: mode,
      provider: "merci_facteur",
      price_ttc: outcome.ok.priceTtc,
    };
    await admin.from("courier_events").insert({
      organization_id, courier_id: anchorId, event_type: "outbound_posted", payload, created_by: userId,
    } as never);
    if (!courier.parent_courier_id) {
      const { data: rels } = await admin
        .from("courier_relations")
        .select("source_courier_id, target_courier_id")
        .eq("organization_id", organization_id)
        .or(`source_courier_id.eq.${courier.id},target_courier_id.eq.${courier.id}`);
      const linked = Array.from(new Set(((rels ?? []) as { source_courier_id: string; target_courier_id: string }[])
        .map((r) => (r.source_courier_id === courier.id ? r.target_courier_id : r.source_courier_id))));
      if (linked.length) {
        await admin.from("courier_events").insert(linked.map((id) => ({
          organization_id, courier_id: id, event_type: "outbound_posted", payload, created_by: userId,
        })) as never);
      }
    }

    return json({
      success: true,
      posted_at: sentAt,
      envoi_id: outcome.ok.envoiId,
      price_ttc: outcome.ok.priceTtc,
      declared: !postErr,
    });
  } catch (err) {
    console.error("send-postal-letter error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});
