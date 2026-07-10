// check-access — validates a share link token.
//
// Four access modes are determined by two flags on the link:
//   restrict_to_recipients | require_verification | behaviour
//   false                  | false               | open (anyone)
//   false                  | true                | anyone + OTP
//   true                   | false               | recipients list, no OTP
//   true                   | true                | recipients list + OTP
//
// Mode 1 – POST { token }
//   Probe only. Returns require_verification, restrict_to_recipients, title.
//   No email is checked.
//
// Mode 2 – POST { token, email }
//   Verify email. For restrict=true links, checks link_recipients.
//   Returns { allowed, require_verification } so the caller knows whether
//   to proceed to OTP or load directly.
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
        "id, is_active, require_verification, restrict_to_recipients, access_expires_at, documents ( title )",
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

    // Probe mode — no email provided, just return link settings.
    if (!email) {
      return jsonResponse({
        require_verification: link.require_verification,
        restrict_to_recipients: link.restrict_to_recipients,
        title,
        // Convenience: pre-allow if open access (no email check needed)
        allowed: !link.require_verification && !link.restrict_to_recipients,
      });
    }

    const normalised = email.trim().toLowerCase();

    // Check recipient list if restriction is on.
    if (link.restrict_to_recipients) {
      const { data: recipient } = await admin
        .from("link_recipients")
        .select("id")
        .eq("link_id", link.id)
        .eq("email", normalised)
        .maybeSingle();

      if (!recipient) {
        return jsonResponse({
          allowed: false,
          reason: "email_not_authorized",
        });
      }
    }

    // Email passes — caller proceeds to OTP if require_verification, else loads directly.
    return jsonResponse({
      allowed: true,
      require_verification: link.require_verification,
      title,
    });
  } catch (_err) {
    return jsonResponse({ error: "Bad request" }, 400);
  }
});
