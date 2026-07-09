// serve-document — the only path through which a viewer receives file bytes.
// Requires a valid Supabase Auth session (created via email OTP) whose email
// matches the share link's allowed email. The original PDF never leaves
// storage unwatermarked: every page is stamped server-side with the viewer's
// email, IP address, and a UTC timestamp before the response is sent.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  degrees,
  PDFDocument,
  rgb,
  StandardFonts,
} from "https://esm.sh/pdf-lib@1.17.1";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { token } = await req.json();
    if (!token) return jsonResponse({ error: "Missing token" }, 400);

    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace("Bearer ", "");
    if (!jwt) return jsonResponse({ error: "Not authenticated" }, 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Identify the viewer from their OTP-verified session.
    const { data: userData, error: userError } = await admin.auth.getUser(jwt);
    if (userError || !userData.user?.email) {
      return jsonResponse({ error: "Not authenticated" }, 401);
    }
    const viewerEmail = userData.user.email.toLowerCase();

    const { data: link } = await admin
      .from("share_links")
      .select("id, allowed_email, is_active, document_id, documents ( id, title, storage_path )")
      .eq("token", token)
      .single();

    if (!link || !link.is_active) {
      return jsonResponse({ error: "Link not found or revoked" }, 404);
    }
    if (link.allowed_email.trim().toLowerCase() !== viewerEmail) {
      return jsonResponse({ error: "Access denied" }, 403);
    }

    const doc = link.documents as unknown as {
      id: string;
      title: string;
      storage_path: string;
    };

    const { data: file, error: dlError } = await admin.storage
      .from("documents")
      .download(doc.storage_path);
    if (dlError || !file) {
      return jsonResponse({ error: "File unavailable" }, 500);
    }

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
    const timestamp = new Date().toISOString().replace("T", " ").slice(0, 19) +
      " UTC";
    const watermarkText = `${viewerEmail}  ·  ${ip}  ·  ${timestamp}`;

    // Stamp every page: a large diagonal watermark plus a footer line.
    const pdf = await PDFDocument.load(await file.arrayBuffer(), {
      ignoreEncryption: true,
    });
    const font = await pdf.embedFont(StandardFonts.HelveticaBold);
    const gray = rgb(0.45, 0.45, 0.45);

    for (const page of pdf.getPages()) {
      const { width, height } = page.getSize();
      const diagonalSize = Math.min(
        24,
        (Math.sqrt(width * width + height * height) * 0.82) /
          font.widthOfTextAtSize(watermarkText, 1),
      );
      const textWidth = font.widthOfTextAtSize(watermarkText, diagonalSize);
      const angle = Math.atan2(height, width);

      page.drawText(watermarkText, {
        x: width / 2 - (textWidth / 2) * Math.cos(angle),
        y: height / 2 - (textWidth / 2) * Math.sin(angle),
        size: diagonalSize,
        font,
        color: gray,
        opacity: 0.28,
        rotate: degrees((angle * 180) / Math.PI),
      });

      page.drawText(`CONFIDENTIAL — ${watermarkText}`, {
        x: 16,
        y: 8,
        size: 7,
        font,
        color: gray,
        opacity: 0.85,
      });
    }
    const stamped = await pdf.save();

    // Record the view session for owner analytics.
    const { data: session } = await admin
      .from("view_sessions")
      .insert({
        share_link_id: link.id,
        document_id: doc.id,
        viewer_email: viewerEmail,
        ip_address: ip,
        user_agent: req.headers.get("user-agent") ?? null,
      })
      .select("id")
      .single();

    return new Response(stamped, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/pdf",
        "Cache-Control": "no-store",
        "Access-Control-Expose-Headers": "x-session-id, x-doc-title",
        "x-session-id": session?.id ?? "",
        "x-doc-title": encodeURIComponent(doc.title),
      },
    });
  } catch (_err) {
    return jsonResponse({ error: "Bad request" }, 400);
  }
});
