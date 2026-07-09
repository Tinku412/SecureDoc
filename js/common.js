/* Shared helpers used by app, dashboard and viewer pages. */

// Use implicit flow so tokens arrive in the URL hash — no server-side code
// exchange step, no race between the auto-exchange and getSession().
const sb = supabase.createClient(
  SECUREDOC_CONFIG.SUPABASE_URL,
  SECUREDOC_CONFIG.SUPABASE_ANON_KEY,
  {
    auth: {
      flowType: "implicit",
      detectSessionInUrl: true,
      persistSession: true,
    },
  }
);

const FUNCTIONS_URL = `${SECUREDOC_CONFIG.SUPABASE_URL}/functions/v1`;

function $(sel) {
  return document.querySelector(sel);
}

function show(el) {
  el.classList.remove("hidden");
}

function hide(el) {
  el.classList.add("hidden");
}

function setAlert(el, message, kind) {
  el.textContent = message;
  el.className = `alert alert-${kind}`;
}

function clearAlert(el) {
  el.textContent = "";
  el.className = "alert hidden";
}

function formatAuthError(error, fallback = "Unexpected authentication error.") {
  if (!error) return fallback;
  if (typeof error === "string") return error;
  if (error.message && typeof error.message === "string" && error.message.trim()) {
    return error.message;
  }
  if (error.error_description && typeof error.error_description === "string") {
    return error.error_description;
  }
  if (error.error && typeof error.error === "string") {
    return error.error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return fallback;
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds || 0));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/* Absolute redirect URL. On localhost, always use the local origin so
   development works; otherwise use SITE_URL (or fall back to the origin). */
function getRedirectUrl(page) {
  const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(
    window.location.hostname
  );
  const base = (
    isLocal ? window.location.origin : SECUREDOC_CONFIG.SITE_URL || window.location.origin
  )
    .trim()
    .replace(/\/$/, "");
  const safePage = page.startsWith("/") ? page : `/${page}`;
  return `${base}${safePage}`;
}

/* If the OAuth provider bounced back with an error (e.g. "Unable to exchange
   external code"), it arrives as ?error_description=... — read and clear it. */
function consumeAuthErrorFromUrl() {
  const search = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const description =
    search.get("error_description") || hash.get("error_description");
  const code = search.get("error") || hash.get("error");
  if (!description && !code) return null;
  window.history.replaceState({}, "", window.location.pathname);
  return decodeURIComponent((description || code).replace(/\+/g, " "));
}

/* Wait for Supabase to finish processing the URL (implicit flow puts tokens
   in the hash; detectSessionInUrl extracts them async). onAuthStateChange
   fires INITIAL_SESSION once that is done — either with a session or null. */
function waitForSession() {
  return new Promise((resolve) => {
    const { data: { subscription } } = sb.auth.onAuthStateChange((event, session) => {
      if (event === "INITIAL_SESSION" || event === "SIGNED_IN") {
        subscription.unsubscribe();
        // Clean auth tokens out of the address bar.
        if (window.location.hash.includes("access_token")) {
          window.history.replaceState(
            {},
            "",
            window.location.pathname + window.location.search
          );
        }
        resolve(session);
      }
    });
  });
}

/* Used by app.html and dashboard.html — redirects to landing if not signed in.
   If the OAuth provider returned an error, surface it instead of silently
   bouncing, so configuration problems are visible. */
async function requireOwnerSession() {
  const authError = consumeAuthErrorFromUrl();
  if (authError) {
    alert(
      "Google sign-in failed.\n\n" +
        authError +
        "\n\nThis usually means the Google Client ID or Client Secret in " +
        "Supabase (Authentication → Providers → Google) is incorrect."
    );
    window.location.href = "index.html";
    return null;
  }

  const session = await waitForSession();
  if (!session) {
    window.location.href = "index.html";
    return null;
  }
  return session;
}

async function signInWithGoogle(redirectPage) {
  const { error } = await sb.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: getRedirectUrl(redirectPage) },
  });
  if (error) throw error;
}

async function signOut() {
  await sb.auth.signOut();
  window.location.href = "index.html";
}
