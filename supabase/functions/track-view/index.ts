// track-view — receives periodic heartbeats from the viewer.
// For OTP-verified (private link) users: email must match the session.
// For anonymous (public link) users: session existence is enough.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

interface PageStat {
  page: number;
  seconds: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { session_id, total_seconds, pages } = await req.json();
    if (!session_id) return jsonResponse({ error: "Missing session_id" }, 400);

    const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    if (!jwt) return jsonResponse({ error: "Not authenticated" }, 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: userData, error: userError } = await admin.auth.getUser(jwt);
    if (userError || !userData.user) {
      return jsonResponse({ error: "Not authenticated" }, 401);
    }

    const isAnonymous = userData.user.is_anonymous ?? false;

    const { data: session } = await admin
      .from("view_sessions")
      .select("id, viewer_email")
      .eq("id", session_id)
      .single();

    if (!session) {
      return jsonResponse({ error: "Session not found" }, 404);
    }

    // Private links: verify the caller's verified email owns this session.
    // Public/anonymous links: just verify the session exists (no email to match).
    if (!isAnonymous) {
      const userEmail = userData.user.email?.toLowerCase() ?? "";
      if (!userEmail || session.viewer_email !== userEmail) {
        return jsonResponse({ error: "Access denied" }, 403);
      }
    }

    await admin
      .from("view_sessions")
      .update({ total_seconds: Math.max(0, Math.round(total_seconds ?? 0)) })
      .eq("id", session_id);

    if (Array.isArray(pages) && pages.length > 0) {
      const rows = (pages as PageStat[])
        .filter((p) => Number.isFinite(p.page) && p.page > 0)
        .map((p) => ({
          session_id,
          page_number: Math.round(p.page),
          seconds_spent: Math.max(0, Math.round(p.seconds)),
        }));
      if (rows.length > 0) {
        await admin
          .from("page_views")
          .upsert(rows, { onConflict: "session_id,page_number" });
      }
    }

    return jsonResponse({ ok: true });
  } catch (_err) {
    return jsonResponse({ error: "Bad request" }, 400);
  }
});
