/**
 * P4.3-Sb3 — Inspector Auth (Browser Session)
 *
 * Handles login/logout flow with HttpOnly cookies.
 * Tokens are NEVER stored in localStorage, sessionStorage, or console-logged.
 *
 * Exports on window.ALiXAuth:
 *   - init()           Called once on page load.
 *   - onFetchError()   Called by app.js when a fetch returns 401.
 *   - isAuthenticated  True if a session cookie exists (best-effort check).
 */

const LOGIN_OVERLAY = "login-overlay";
const AUTH_BAR = "auth-bar";
const TOKEN_INPUT = "token-input";
const LOGIN_ERROR = "login-error";
const LOGIN_BTN = "login-btn";
const LOGOUT_BTN = "logout-btn";
const AUTH_ROLE = "auth-role";

let authenticated = false;
let currentRole = "";

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function el(id) {
  return document.getElementById(id);
}

function show(id) {
  el(id)?.classList.remove("hidden");
}

function hide(id) {
  el(id)?.classList.add("hidden");
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

async function doLogin() {
  const input = el(TOKEN_INPUT);
  const errEl = el(LOGIN_ERROR);
  const btn = el(LOGIN_BTN);

  const raw = input.value.trim();
  if (!raw) {
    errEl.textContent = "Please enter a token.";
    show(LOGIN_ERROR);
    return;
  }

  btn.disabled = true;
  btn.textContent = "Authenticating...";
  hide(LOGIN_ERROR);

  try {
    const res = await fetch("/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: raw }),
    });

    // DO NOT log the token or response
    if (res.ok) {
      const data = await res.json();
      // data = { role, expiresAt }
      currentRole = data.role || "unknown";
      authenticated = true;

      // Clear the token input immediately
      input.value = "";

      // Hide login, show auth bar
      hide(LOGIN_OVERLAY);
      show(AUTH_BAR);
      el(AUTH_ROLE).textContent = "Role: " + currentRole;

      // Reload data panels now that we're authenticated
      reloadData();
    } else {
      const data = await res.json().catch(() => ({}));
      const msg = data.error || "Authentication failed";
      errEl.textContent = msg === "invalid_token" ? "Invalid token" :
        msg === "token_expired" ? "Token expired" :
        msg === "token_revoked" ? "Token revoked" : "Authentication failed";
      show(LOGIN_ERROR);
    }
  } catch {
    errEl.textContent = "Network error. Try again.";
    show(LOGIN_ERROR);
  } finally {
    btn.disabled = false;
    btn.textContent = "Authenticate";
  }
}

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------

async function doLogout() {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } catch {
    // Best-effort — proceed with clearing UI state
  }

  authenticated = false;
  currentRole = "";

  hide(AUTH_BAR);
  show(LOGIN_OVERLAY);

  // Clear the token input
  const input = el(TOKEN_INPUT);
  if (input) input.value = "";
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

/**
 * Check if we can reach an authenticated endpoint to test cookie validity.
 *
 * If the request succeeds, we're authenticated (cookie is valid).
 * If it fails with 401, we show the login overlay.
 */
async function probeAuth() {
  try {
    const res = await fetch("/api/graphs");
    if (res.ok) {
      // Cookie session is valid
      authenticated = true;
      hide(LOGIN_OVERLAY);
      show(AUTH_BAR);

      // Try to extract role from a protected response
      try {
        const data = await res.json();
        // The response doesn't include role, but we can infer from the data
        currentRole = "active";
        el(AUTH_ROLE).textContent = "Authenticated";
      } catch {
        el(AUTH_ROLE).textContent = "Authenticated";
      }
      return;
    }
    if (res.status === 401) {
      throw new Error("unauthorized");
    }
    // Other errors (500, etc.) — still show login if the session was invalidated
    authenticated = false;
    show(LOGIN_OVERLAY);
  } catch {
    // If we can't reach the server or get 401, show login
    authenticated = false;
    show(LOGIN_OVERLAY);
  }
}

function init() {
  // Wire up the login form
  const form = el("login-form");
  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      doLogin();
    });
  }

  // Wire up logout button
  const logoutBtn = el(LOGOUT_BTN);
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      doLogout();
    });
  }

  // Allow Enter key on token input
  const tokenInput = el(TOKEN_INPUT);
  if (tokenInput) {
    tokenInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        doLogin();
      }
    });
  }

  // Probe auth state
  probeAuth();
}

// ---------------------------------------------------------------------------
// Called by app.js on 401 response
// ---------------------------------------------------------------------------

function onFetchError() {
  if (authenticated) {
    // Session expired — clear auth state and show login
    authenticated = false;
    currentRole = "";
    hide(AUTH_BAR);
    show(LOGIN_OVERLAY);
  }
}

// ---------------------------------------------------------------------------
// Reload data panels after successful login
// ---------------------------------------------------------------------------

function reloadData() {
  // Re-invoke the app's data loading functions if available
  if (typeof window.reloadInspectorData === "function") {
    window.reloadInspectorData();
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

window.ALiXAuth = {
  init,
  onFetchError,
  get isAuthenticated() {
    return authenticated;
  },
};

// Auto-init
init();

// ---------------------------------------------------------------------------
// Fetch interceptor — detect 401 responses and show login
// ---------------------------------------------------------------------------

(function installFetchInterceptor() {
  const _fetch = window.fetch;
  window.fetch = function (url, ...args) {
    return _fetch.call(window, url, ...args).then(function (res) {
      if (res.status === 401 && window.ALiXAuth) {
        window.ALiXAuth.onFetchError();
      }
      return res;
    });
  };
})();
