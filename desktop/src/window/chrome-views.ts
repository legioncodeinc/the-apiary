/**
 * PRD-005b (b-AC-4): the PURE native chrome views (loading + failed) the main window shows BEFORE
 * (and instead of) the dashboard.
 *
 * No `electron` import. These are self-contained HTML documents the main process loads via a
 * `data:` URL while the readiness gate is `loading` or `failed`. They are app-owned chrome, not the
 * dashboard — so the window is NEVER a blank page or a raw Chromium error page while Hive comes up
 * or after it fails to (b-AC-4). The failed view's Retry button navigates to the sentinel URL
 * {@link RETRY_SENTINEL_URL}; the main window's `will-navigate` handler intercepts that exact URL,
 * cancels the navigation, and re-arms the readiness gate. This needs NO preload on the chrome views
 * — the retry signal rides the navigation-policy seam that already governs the window, keeping the
 * bridge surface minimal (b-AC-3).
 *
 * All interpolated text is HTML-escaped so a message can never inject markup.
 */

/** The sentinel URL the Retry button navigates to; `will-navigate` maps it to `gate.retry()` (b-AC-4). */
export const RETRY_SENTINEL_URL = "https://apiary.invalid/__retry";

/** Escape the five HTML-significant characters so interpolated text is inert. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Shared minimal styling for both chrome views — inline, no external assets, no network. */
const SHARED_STYLE = `
  <style>
    :root { color-scheme: light dark; }
    html, body { height: 100%; margin: 0; }
    body {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 1rem; font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
      background: Canvas; color: CanvasText; text-align: center; padding: 2rem;
    }
    .spinner {
      width: 2.5rem; height: 2.5rem; border-radius: 50%;
      border: 3px solid GrayText; border-top-color: transparent; animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    h1 { font-size: 1.1rem; font-weight: 600; margin: 0; }
    p { max-width: 28rem; margin: 0; opacity: 0.85; line-height: 1.5; }
    a.button {
      font: inherit; padding: 0.5rem 1.25rem; border-radius: 0.5rem; border: 1px solid GrayText;
      background: ButtonFace; color: ButtonText; cursor: pointer; text-decoration: none;
    }
    a.button:hover { opacity: 0.9; }
  </style>
`;

/** The loading view shown while the readiness gate is `loading` (b-AC-4). Native, never blank. */
export function renderLoadingHtml(): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><title>Starting Apiary…</title>${SHARED_STYLE}</head>
<body>
  <div class="spinner" role="progressbar" aria-label="Starting"></div>
  <h1>Starting Apiary…</h1>
  <p>Waiting for the Hive dashboard to come online.</p>
</body>
</html>`;
}

/**
 * The failed view shown when the startup budget expires (b-AC-4). Carries the ACTIONABLE message and
 * a Retry link that navigates to {@link RETRY_SENTINEL_URL}, which the window intercepts. Never a
 * raw error page.
 */
export function renderFailedHtml(message: string): string {
  const safeMessage = escapeHtml(message);
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><title>Apiary could not start</title>${SHARED_STYLE}</head>
<body>
  <h1>Apiary could not start</h1>
  <p>${safeMessage}</p>
  <a class="button" href="${RETRY_SENTINEL_URL}" autofocus>Retry</a>
</body>
</html>`;
}

/** Build a `data:` URL for an HTML document so the main process can `loadURL` it with no temp file. */
export function toHtmlDataUrl(html: string): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}
