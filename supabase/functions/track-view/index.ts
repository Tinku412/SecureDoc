// track-view — receives periodic heartbeats from the viewer with total time
// and per-page seconds. Writes are authenticated: the caller's OTP-verified
// email must match the session it is updating.
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
    if (userError || !userData.user?.email) {
      return jsonResponse({ error: "Not authenticated" }, 401);
    }

    const { data: session } = await admin
      .from("view_sessions")
      .select("id, viewer_email")
      .eq("id", session_id)
      .single();

    if (
      !session ||
      session.viewer_email !== userData.user.email.toLowerCase()
    ) {
      return jsonResponse({ error: "Access denied" }, 403);
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
