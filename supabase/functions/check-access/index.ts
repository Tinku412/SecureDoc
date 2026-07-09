// check-access — given a share token and an email, says whether that email
// is allowed to view the document. Called before any OTP is sent so that
// unauthorized emails are refused without ever receiving a code.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { token, email } = await req.json();
    if (!token || !email) {
      return jsonResponse({ error: "Missing token or email" }, 400);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: link } = await admin
      .from("share_links")
      .select("id, allowed_email, is_active, documents ( title )")
      .eq("token", token)
      .single();

    if (!link || !link.is_active) {
      return jsonResponse({ allowed: false, reason: "invalid_link" }, 404);
    }

    const allowed =
      link.allowed_email.trim().toLowerCase() === email.trim().toLowerCase();

    if (!allowed) {
      return jsonResponse({ allowed: false, reason: "email_not_authorized" });
    }

    return jsonResponse({
      allowed: true,
      title: (link.documents as { title: string } | null)?.title ?? "Document",
    });
  } catch (_err) {
    return jsonResponse({ error: "Bad request" }, 400);
  }
});
