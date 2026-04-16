import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Validate caller is authenticated
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Non autorisé" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create service-role client for admin operations
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    // Create anon client to verify the caller
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseCaller = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user: callerUser },
    } = await supabaseCaller.auth.getUser();
    if (!callerUser) {
      return new Response(JSON.stringify({ error: "Non autorisé" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check caller is superadmin or org admin
    const { data: callerProfile } = await supabaseAdmin
      .from("users")
      .select("is_superadmin")
      .eq("id", callerUser.id)
      .single();

    const isSuperAdmin = callerProfile?.is_superadmin === true;

    // Parse request body
    const body = await req.json();
    const { email, first_name, last_name, role, organization_id } = body;

    if (!email || !first_name || !last_name || !role || !organization_id) {
      return new Response(
        JSON.stringify({ error: "Champs obligatoires manquants" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // If not superadmin, verify caller is admin of the target org
    if (!isSuperAdmin) {
      const { data: callerMembership } = await supabaseAdmin
        .from("organization_users")
        .select("role")
        .eq("user_id", callerUser.id)
        .eq("organization_id", organization_id)
        .single();

      if (!callerMembership || callerMembership.role !== "administrateur") {
        return new Response(
          JSON.stringify({
            error: "Vous devez être administrateur de cette organisation",
          }),
          {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
    }

    // Get the redirect URL for account activation
    const origin = req.headers.get("origin") || req.headers.get("referer") || "";
    const baseUrl = origin.replace(/\/$/, "");
    const redirectTo = `${baseUrl}/activer-compte`;

    // 1. Check if auth user already exists
    const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
    const existingAuthUser = existingUsers?.users?.find(
      (u) => u.email?.toLowerCase() === email.toLowerCase()
    );

    let authUserId: string;

    if (existingAuthUser) {
      authUserId = existingAuthUser.id;

      // Check if already linked to this org
      const { data: existingLink } = await supabaseAdmin
        .from("organization_users")
        .select("id")
        .eq("organization_id", organization_id)
        .eq("user_id", authUserId)
        .maybeSingle();

      if (existingLink) {
        return new Response(
          JSON.stringify({
            error: "Cet utilisateur est déjà membre de cette organisation.",
          }),
          {
            status: 409,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
    } else {
      // 2. Create auth user via invite (sends invitation email)
      const { data: inviteData, error: inviteError } =
        await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
          redirectTo,
          data: {
            first_name,
            last_name,
          },
        });

      if (inviteError) {
        console.error("Invite error:", inviteError);
        return new Response(
          JSON.stringify({ error: inviteError.message }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      authUserId = inviteData.user.id;
    }

    // 3. Create/update public.users record with matching auth ID
    const { error: upsertError } = await supabaseAdmin.from("users").upsert(
      {
        id: authUserId,
        email: email.toLowerCase(),
        first_name,
        last_name,
        is_active: true,
      },
      { onConflict: "id" }
    );

    if (upsertError) {
      console.error("Users upsert error:", upsertError);
      return new Response(
        JSON.stringify({ error: upsertError.message }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 4. Create organization_users link
    const { error: linkError } = await supabaseAdmin
      .from("organization_users")
      .insert({
        organization_id,
        user_id: authUserId,
        role,
        is_active: true,
      });

    if (linkError) {
      console.error("Link error:", linkError);
      return new Response(
        JSON.stringify({ error: linkError.message }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        user_id: authUserId,
        message: existingAuthUser
          ? "Utilisateur existant ajouté à l'organisation"
          : "Invitation envoyée avec succès",
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("Unexpected error:", err);
    return new Response(
      JSON.stringify({ error: "Erreur interne du serveur" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
