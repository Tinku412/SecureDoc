// serve-document — sole path through which viewers receive watermarked bytes.
//
// Access modes (require_verification × restrict_to_recipients):
//
//  false × false  → anonymous session, public_label used for watermark
//  false × true   → anonymous session, public_label = claimed email,
//                   verified against link_recipients
//  true  × false  → OTP-proven email session, no list check
//  true  × true   → OTP-proven email session, also checked against list
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
    const { token, public_label } = await req.json();
    if (!token) return jsonResponse({ error: "Missing token" }, 400);

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
    const viewerEmail = isAnonymous
      ? null
      : userData.user.email?.toLowerCase() ?? null;

    const { data: link } = await admin
      .from("share_links")
      .select(
        "id, is_active, require_verification, restrict_to_recipients, access_expires_at, document_id, documents ( id, title, storage_path, download_allowed )",
      )
      .eq("token", token)
      .single();

    if (!link || !link.is_active) {
      return jsonResponse({ error: "Link not found or revoked" }, 404);
    }

    if (
      link.access_expires_at &&
      new Date(link.access_expires_at) < new Date()
    ) {
      return jsonResponse({ error: "This link has expired" }, 403);
    }

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
    const timestamp =
      new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";

    let watermarkText: string;
    let sessionEmail: string;

    if (link.require_verification) {
      // OTP-verified session required.
      if (!viewerEmail) {
        return jsonResponse({ error: "Access denied" }, 403);
      }
      if (link.restrict_to_recipients) {
        const { data: recip } = await admin
          .from("link_recipients")
          .select("id")
          .eq("link_id", link.id)
          .eq("email", viewerEmail)
          .maybeSingle();
        if (!recip) return jsonResponse({ error: "Access denied" }, 403);
      }
      watermarkText = `${viewerEmail}  ·  ${ip}  ·  ${timestamp}`;
      sessionEmail = viewerEmail;
    } else {
      // Anonymous session — public_label is the self-reported identity.
      const label = (public_label ?? "").trim().slice(0, 80) || ip;
      if (link.restrict_to_recipients) {
        // Verify the claimed email is in the recipient list.
        const { data: recip } = await admin
          .from("link_recipients")
          .select("id")
          .eq("link_id", link.id)
          .eq("email", label.toLowerCase())
          .maybeSingle();
        if (!recip) return jsonResponse({ error: "Access denied" }, 403);
      }
      watermarkText = `${label}  ·  ${ip}  ·  ${timestamp}`;
      sessionEmail = label;
    }

    const doc = link.documents as unknown as {
      id: string;
      title: string;
      storage_path: string;
      download_allowed: boolean;
    };

    const { data: file, error: dlError } = await admin.storage
      .from("documents")
      .download(doc.storage_path);
    if (dlError || !file) {
      return jsonResponse({ error: "File unavailable" }, 500);
    }

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

    const { data: sessionRow } = await admin
      .from("view_sessions")
      .insert({
        share_link_id: link.id,
        document_id: doc.id,
        viewer_email: sessionEmail,
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
        "Access-Control-Expose-Headers":
          "x-session-id, x-doc-title, x-download-allowed",
        "x-session-id": sessionRow?.id ?? "",
        "x-doc-title": encodeURIComponent(doc.title),
        "x-download-allowed": doc.download_allowed ? "true" : "false",
      },
    });
  } catch (_err) {
    return jsonResponse({ error: "Bad request" }, 400);
  }
});
