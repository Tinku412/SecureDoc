# SecureDoc

Share confidential PDFs with control. Upload a document, lock it to one email
address, send a link. The recipient verifies their email with a one-time code,
and every page they see — on screen and in downloads — is watermarked with
their email, IP address, and timestamp. A dashboard shows who opened what,
when, from where, and how long they spent on each page.

## Stack

| Layer | Technology |
|---|---|
| Frontend | Static HTML / CSS / JavaScript (no build step) |
| Hosting | Cloudflare Pages |
| Auth | Supabase Auth — Google OAuth (owners), email OTP (viewers) |
| Database | Supabase Postgres with row level security |
| File storage | Supabase Storage (private bucket, encrypted at rest) |
| Watermarking | `pdf-lib` inside a Supabase Edge Function (server-side) |
| PDF rendering | `pdf.js` (CDN) |

## Project layout

```
index.html                     Landing page
app.html                       Owner app: upload, create/revoke share links
dashboard.html                 Owner analytics dashboard
view.html                      Recipient viewer: email gate, OTP, watermarked PDF
css/styles.css                 Design system
js/config.js                   Supabase URL + anon key (fill in)
js/common.js                   Shared client helpers
supabase/schema.sql            Tables, RLS policies, storage bucket + policies
supabase/functions/
  check-access/                Is this email allowed on this link?
  serve-document/              Watermarks + streams the PDF, records the open
  track-view/                  Receives time-on-page heartbeats
```

## Setup

### 1. Create a Supabase project

1. Create a project at [supabase.com](https://supabase.com).
2. Open the SQL editor and run the whole of `supabase/schema.sql`. This
   creates the tables, RLS policies, and the private `documents` storage
   bucket (50 MB limit, PDFs only).

### 2. Configure Google OAuth (for document owners)

1. In [Google Cloud Console](https://console.cloud.google.com), create an
   OAuth 2.0 Client ID (type: Web application).
2. Add the authorized redirect URI shown in Supabase under
   **Authentication → Providers → Google**
   (it looks like `https://<ref>.supabase.co/auth/v1/callback`).
3. Paste the client ID and secret into the Supabase Google provider settings
   and enable it.

### 3. Configure email OTP (for document viewers)

1. In Supabase, go to **Authentication → Email templates → Magic Link** and
   change the template so it sends a code instead of a link, e.g.:

   ```html
   <h2>Your SecureDoc verification code</h2>
   <p>Enter this code to open the document:</p>
   <h1>{{ .Token }}</h1>
   <p>This code expires in one hour. If you didn't request it, ignore this email.</p>
   ```

2. Under **Authentication → Providers → Email**, keep Email enabled.
   Supabase's built-in mailer works for testing; connect a custom SMTP
   provider (**Settings → Auth → SMTP**) before real use, since the built-in
   mailer is heavily rate-limited.

### 4. Deploy the edge functions

With the [Supabase CLI](https://supabase.com/docs/guides/cli) installed:

```bash
supabase login
supabase link --project-ref <your-project-ref>
supabase functions deploy check-access
supabase functions deploy serve-document
supabase functions deploy track-view
```

The functions use `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, which
Supabase injects automatically — no secrets to configure.

### 5. Configure the frontend

Edit `js/config.js` with your project values from
**Settings → API** in Supabase:

```js
const SECUREDOC_CONFIG = {
  SUPABASE_URL: "https://<your-ref>.supabase.co",
  SUPABASE_ANON_KEY: "<your-anon-public-key>",
};
```

### 6. Deploy to Cloudflare Pages

1. Push this folder to a Git repository.
2. In the [Cloudflare dashboard](https://dash.cloudflare.com), create a
   Pages project from that repository. Framework preset: **None**,
   build command: empty, output directory: `/`.
3. After the first deploy, add your Pages URL to Supabase under
   **Authentication → URL Configuration** (Site URL and redirect URLs),
   otherwise Google sign-in will bounce back to localhost.

For local development, any static server works:

```bash
npx serve .
```

(then use `http://localhost:3000` as an additional redirect URL in Supabase).

## How the security model works

- **Files are never public.** The storage bucket is private. Owners can only
  touch files inside their own `{user_id}/` folder (enforced by storage RLS).
  Viewers never access storage at all.
- **The only path to file bytes for a viewer** is the `serve-document` edge
  function, which requires a Supabase Auth session created via email OTP and
  checks that the session's email matches the link's allowed email. The
  original file never leaves the server unwatermarked.
- **Watermarking is server-side** (`pdf-lib` in the edge function), so the
  downloaded file carries the same diagonal watermark and footer on every
  page. A client can't strip it by intercepting the response — there is no
  clean copy to intercept.
- **Unauthorized emails never receive an OTP.** `check-access` refuses before
  any code is sent, so the link leaks nothing to the wrong person.
- **All analytics writes are authenticated.** `track-view` verifies the
  caller's OTP session email matches the view session it is updating, so
  analytics can't be spoofed or polluted by third parties.
- **Owner data is isolated by RLS.** Owners can read only their own
  documents, links, sessions, and page views.
- **Transport and at-rest encryption** come from Supabase/Cloudflare (TLS
  everywhere, AES-256 at rest), and watermarked responses are sent with
  `Cache-Control: no-store`.

### Compliance notes (MVP-level)

- Viewer IP addresses and emails are collected for watermarking and audit
  analytics — disclose this in your privacy policy; the viewer page states
  "views are recorded" before the document opens.
- Deleting a document cascades to its links, sessions, and page analytics
  (supports erasure requests).
- For stricter regimes (SOC 2, HIPAA), add audit log exports, retention
  policies, and a signed DPA with Supabase — out of scope for this MVP.

## Feature checklist

- Upload PDF → unique share link per recipient
- Link locked to one pre-specified email; anyone else is refused without OTP
- Email verified with a one-time code before the document opens
- Every page watermarked with viewer email + IP + UTC timestamp
- Download carries the identical watermark on all pages
- Dashboard: opens per document, reader identity, IP, open time, total
  reading time, and time spent per page
- Links can be revoked at any time; documents can be deleted
