// check-access — two modes:
//   1. { token }          → probe: returns is_public + whether link is valid (no email revealed)
//   2. { token, email }   → verify: checks email match (private links only)
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
      .select("id, allowed_email, is_active, is_public, access_expires_at, documents ( title )")
      .eq("token", token)
      .single();

    if (!link || !link.is_active) {
      return jsonResponse({ allowed: false, reason: "invalid_link" }, 404);
    }

    // Expiry check.
    if (link.access_expires_at && new Date(link.access_expires_at) < new Date()) {
      return jsonResponse({ allowed: false, reason: "link_expired" });
    }

    const title = (link.documents as { title: string } | null)?.title ?? "Document";

    // Public link — no email required.
    if (link.is_public) {
      return jsonResponse({ allowed: true, is_public: true, title });
    }

    // Probe mode: caller didn't supply an email yet, just checking link type.
    if (!email) {
      return jsonResponse({ allowed: false, is_public: false, reason: "email_required" });
    }

    // Email match check.
    const match =
      (link.allowed_email ?? "").trim().toLowerCase() === email.trim().toLowerCase();

    if (!match) {
      return jsonResponse({ allowed: false, is_public: false, reason: "email_not_authorized" });
    }

    return jsonResponse({ allowed: true, is_public: false, title });
  } catch (_err) {
    return jsonResponse({ error: "Bad request" }, 400);
  }
});
