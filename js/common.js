/* Shared helpers used by app, dashboard and viewer pages. */

const sb = supabase.createClient(
  SECUREDOC_CONFIG.SUPABASE_URL,
  SECUREDOC_CONFIG.SUPABASE_ANON_KEY
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

/* Requires a signed-in owner; redirects to the landing page otherwise.
   Returns the session. */
async function requireOwnerSession() {
  const { data } = await sb.auth.getSession();
  if (!data.session) {
    window.location.href = "index.html";
    return null;
  }
  return data.session;
}

async function signInWithGoogle(redirectPage) {
  await sb.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${window.location.origin}${window.location.pathname.replace(/[^/]*$/, "")}${redirectPage}`,
    },
  });
}

async function signOut() {
  await sb.auth.signOut();
  window.location.href = "index.html";
}
