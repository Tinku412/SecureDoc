/* Shared helpers used by app, dashboard and viewer pages.

   Note: there is currently no owner sign-in — the dashboard (app.html) is
   fully open under the anon key (see supabase/migration_v6.sql). The
   viewer-facing flow in view.html still uses Supabase auth (anonymous
   sign-in / email OTP verification) to identify and verify readers before
   opening a document — that is unrelated to owner sign-in and is left
   untouched. */
const sb = supabase.createClient(
  SECUREDOC_CONFIG.SUPABASE_URL,
  SECUREDOC_CONFIG.SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: true,
    },
  }
);

const FUNCTIONS_URL = `${SECUREDOC_CONFIG.SUPABASE_URL}/functions/v1`;

function $(sel) {
  return document.querySelector(sel);
}

function show(el) {
  if (!el) return;
  el.classList.remove("hidden");
}

function hide(el) {
  if (!el) return;
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

