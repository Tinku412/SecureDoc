// serve-document — sole path through which viewers receive watermarked bytes.
//
// Access modes (require_verification × restrict_to_recipients):
//
//  false × false  → anonymous session, public_label used for watermark
//  false × true   → anonymous session, public_label = claimed email,
//                   verified against link_recipients
//  true  × false  → OTP-proven email session, no list check
//  true  × true   → OTP-proven email session, also checked against list
//
// Watermark appearance is controlled per-link by three settings:
//  watermark_layout:    'single_line' | 'stacked'
//  watermark_direction: 'diagonal' | 'horizontal' | 'vertical'
//  watermark_repeat:    'single' | 'tiled'
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  degrees,
  PDFDocument,
  rgb,
  StandardFonts,
} from "https://esm.sh/pdf-lib@1.17.1";
import type { PDFFont, PDFPage, RGB } from "https://esm.sh/pdf-lib@1.17.1";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

function computeAngleRadians(
  direction: string,
  width: number,
  height: number,
): number {
  if (direction === "horizontal") return 0;
  if (direction === "vertical") return Math.PI / 2;
  return Math.atan2(height, width); // diagonal — corner to corner
}

function fitFontSize(
  font: PDFFont,
  text: string,
  maxWidth: number,
  maxSize: number,
  minSize = 6,
): number {
  let size = maxSize;
  while (size > minSize && font.widthOfTextAtSize(text, size) > maxWidth) {
    size -= 1;
  }
  return size;
}

function longestLine(lines: string[]): string {
  return lines.reduce((a, b) => (a.length >= b.length ? a : b));
}

// Draws one or more lines of text centered on (centerX, centerY), rotated by
// angleRad, stacking additional lines perpendicular to the text direction.
function drawTextBlock(
  page: PDFPage,
  lines: string[],
  font: PDFFont,
  centerX: number,
  centerY: number,
  fontSize: number,
  angleRad: number,
  color: RGB,
  opacity: number,
) {
  const lineGap = fontSize * 1.35;
  const perpX = -Math.sin(angleRad);
  const perpY = Math.cos(angleRad);
  const total = lines.length;

  lines.forEach((line, i) => {
    const lineOffset = (i - (total - 1) / 2) * lineGap;
    const lineWidth = font.widthOfTextAtSize(line, fontSize);
    const x = centerX - (lineWidth / 2) * Math.cos(angleRad) +
      perpX * lineOffset;
    const y = centerY - (lineWidth / 2) * Math.sin(angleRad) +
      perpY * lineOffset;
    page.drawText(line, {
      x,
      y,
      size: fontSize,
      font,
      color,
      opacity,
      rotate: degrees((angleRad * 180) / Math.PI),
    });
  });
}

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
        "id, is_active, require_verification, restrict_to_recipients, access_expires_at, document_id, download_allowed, watermark_layout, watermark_direction, watermark_repeat, cta_headline, cta_button_text, cta_button_url, documents ( id, title, storage_path, type, source_url )",
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

    const doc = link.documents as unknown as {
      id: string;
      title: string;
      storage_path: string | null;
      type: string;
      source_url: string | null;
    };

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
    const timestamp =
      new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";

    let identity: string;
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
      identity = viewerEmail;
      sessionEmail = viewerEmail;
    } else {
      // Anonymous session — public_label is the self-reported identity.
      const label = (public_label ?? "").trim().slice(0, 80) || ip;
      if (link.restrict_to_recipients) {
        const { data: recip } = await admin
          .from("link_recipients")
          .select("id")
          .eq("link_id", link.id)
          .eq("email", label.toLowerCase())
          .maybeSingle();
        if (!recip) return jsonResponse({ error: "Access denied" }, 403);
      }
      identity = label;
      sessionEmail = label;
    }

    // URL items skip watermarking entirely — record the open for analytics
    // and hand back the target URL plus this link's CTA settings as JSON.
    if (doc.type === "url") {
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

      return jsonResponse({
        url: doc.source_url,
        session_id: sessionRow?.id ?? "",
        cta_headline: (link.cta_headline ?? "").trim(),
        cta_button_text: (link.cta_button_text ?? "").trim(),
        cta_button_url: (link.cta_button_url ?? "").trim(),
      });
    }

    const singleLineText = `${identity}  ·  ${ip}  ·  ${timestamp}`;
    const stackedLines = [identity, `IP: ${ip}`, timestamp];

    const watermarkLayout = link.watermark_layout || "single_line";
    const watermarkDirection = link.watermark_direction || "diagonal";
    const watermarkRepeat = link.watermark_repeat || "single";

    const { data: file, error: dlError } = await admin.storage
      .from("documents")
      .download(doc.storage_path!);
    if (dlError || !file) {
      return jsonResponse({ error: "File unavailable" }, 500);
    }

    const pdf = await PDFDocument.load(await file.arrayBuffer(), {
      ignoreEncryption: true,
    });
    const font = await pdf.embedFont(StandardFonts.HelveticaBold);
    const gray = rgb(0.45, 0.45, 0.45);

    const lines = watermarkLayout === "stacked"
      ? stackedLines
      : [singleLineText];

    for (const page of pdf.getPages()) {
      const { width, height } = page.getSize();
      const angleRad = computeAngleRadians(watermarkDirection, width, height);
      const longest = longestLine(lines);

      if (watermarkRepeat === "tiled") {
        const landscape = width > height;
        const cols = landscape ? 3 : 2;
        const rows = landscape ? 2 : 3;
        const tileFont = fitFontSize(font, longest, (width / cols) * 0.9, 14);
        const stepX = width / (cols + 1);
        const stepY = height / (rows + 1);
        for (let r = 1; r <= rows; r++) {
          for (let c = 1; c <= cols; c++) {
            drawTextBlock(
              page,
              lines,
              font,
              stepX * c,
              stepY * r,
              tileFont,
              angleRad,
              gray,
              0.16,
            );
          }
        }
      } else {
        let fontSize: number;
        if (watermarkDirection === "diagonal") {
          const diagLen = Math.sqrt(width * width + height * height) * 0.82;
          fontSize = Math.min(26, diagLen / font.widthOfTextAtSize(longest, 1));
        } else if (watermarkDirection === "horizontal") {
          fontSize = fitFontSize(font, longest, width * 0.82, 26);
        } else {
          fontSize = fitFontSize(font, longest, height * 0.82, 26);
        }
        drawTextBlock(
          page,
          lines,
          font,
          width / 2,
          height / 2,
          fontSize,
          angleRad,
          gray,
          0.28,
        );
      }

      // Compact footer — always single line, bottom-left, regardless of style.
      page.drawText(`CONFIDENTIAL — ${singleLineText}`, {
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

    const ctaHeadline = (link.cta_headline ?? "").trim();
    const ctaButtonText = (link.cta_button_text ?? "").trim();
    const ctaButtonUrl = (link.cta_button_url ?? "").trim();

    return new Response(stamped, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/pdf",
        "Cache-Control": "no-store",
        "Access-Control-Expose-Headers":
          "x-session-id, x-doc-title, x-download-allowed, x-cta-headline, x-cta-button-text, x-cta-button-url",
        "x-session-id": sessionRow?.id ?? "",
        "x-doc-title": encodeURIComponent(doc.title),
        "x-download-allowed": link.download_allowed ? "true" : "false",
        "x-cta-headline": encodeURIComponent(ctaHeadline),
        "x-cta-button-text": encodeURIComponent(ctaButtonText),
        "x-cta-button-url": encodeURIComponent(ctaButtonUrl),
      },
    });
  } catch (_err) {
    return jsonResponse({ error: "Bad request" }, 400);
  }
});
