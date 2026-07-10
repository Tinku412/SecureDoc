// check-access — validates a share link token.
//
// Mode 1: { token }         — probe: returns require_verification + title.
// Mode 2: { token, email }  — verify: for private links, checks the email
//                             against link_recipients; public links always pass.
//
// Also enforces access_expires_at if set.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const token: string | undefined = body?.token;
    const email: string | undefined = body?.email;

    if (!token) return jsonResponse({ error: "Missing token" }, 400);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: link } = await admin
      .from("share_links")
      .select(
        "id, is_active, require_verification, access_expires_at, documents ( title )",
      )
      .eq("token", token)
      .single();

    if (!link || !link.is_active) {
      return jsonResponse({ allowed: false, reason: "invalid_link" }, 404);
    }

    if (
      link.access_expires_at &&
      new Date(link.access_expires_at) < new Date()
    ) {
      return jsonResponse({ allowed: false, reason: "link_expired" });
    }

    const title =
      (link.documents as { title: string } | null)?.title ?? "Document";

    // Probe mode: caller just wants to know the link type, not checking access.
    if (!email) {
      return jsonResponse({
        allowed: !link.require_verification, // public links are immediately allowed
        require_verification: link.require_verification,
        title,
      });
    }

    // Public link — no email check needed.
    if (!link.require_verification) {
      return jsonResponse({
        allowed: true,
        require_verification: false,
        title,
      });
    }

    // Private link — email must be in the recipient list.
    const normalised = email.trim().toLowerCase();
    const { data: recipient } = await admin
      .from("link_recipients")
      .select("id")
      .eq("link_id", link.id)
      .eq("email", normalised)
      .maybeSingle();

    if (!recipient) {
      return jsonResponse({
        allowed: false,
        require_verification: true,
        reason: "email_not_authorized",
      });
    }

    return jsonResponse({ allowed: true, require_verification: true, title });
  } catch (_err) {
    return jsonResponse({ error: "Bad request" }, 400);
  }
});
