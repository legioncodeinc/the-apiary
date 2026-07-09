// site/install/_worker.js — Cloudflare Pages ADVANCED-MODE worker for get.theapiary.sh.
//
// WHY A _worker.js AND NOT functions/: a Direct-Upload deploy (`wrangler pages deploy
// site/install/dist`) uploads only the asset directory and does NOT reliably compile a sibling
// `functions/` directory, so the file-based Function never deployed and the bare "/" fell back to
// Pages' default static serving (index.html). A shell client then piped HTML into `sh`
// ("Syntax error: newline unexpected"). A `_worker.js` placed at the ROOT of the deployed output
// is executed by Pages for EVERY request, deterministically, with no functions-discovery step. It
// is copied into dist/ by build.mjs.
//
// It only special-cases GET "/", GET "/uninstall", and GET "/update" for script-vs-page content
// negotiation (the get.pnpm.io / sh.rustup.rs pattern):
//   GET / from a SHELL client (curl/wget/fetch)      → install.sh as text/plain, so `| sh` works.
//   GET / from a BROWSER (Accept: text/html)         → the human "inspect before piping" page.
//   GET /uninstall from a SHELL client               → uninstall.sh as text/plain.
//   GET /uninstall from a BROWSER                    → the same inspect page.
//   GET /update from a SHELL client                  → update.sh as text/plain.
//   GET /update from a BROWSER                       → the same inspect page.
// Every other path (/install.sh, /install.ps1, /SHA256SUMS, /hive-release.json, …) is forwarded to
// the static asset pipeline via env.ASSETS.fetch, which still applies the _headers rules
// (text/plain + nosniff) unchanged.
//
// PRD-002a a-AC-4: a shell client hitting `/?combo=<name>` gets the SAME install.sh bytes with one
// extra `export HONEYCOMB_INSTALL_PRODUCTS=...` line prepended (the same env var install.sh already
// reads). Combo responses are deliberately NOT byte-identical to the checksummed install.sh, so
// they are never what SHA256SUMS covers; the inspect page always verifies the un-prefixed script.

const COMBO_PRESETS = {
	// Keep PRODUCT VALUES in sync with scripts/install/install.sh (resolve_code_products /
	// resolve_profile_products). This is a separate install-SITE-side convenience (env-var
	// injection), not the same code path.
	full: { products: "honeycomb,doctor,hive,nectar", profile: "full" },
};

// The inspect-page CSP (kept in sync with the "/" + "/index.html" rules in _headers).
const INSPECT_CSP =
	"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export default {
	async fetch(request, env) {
		const url = new URL(request.url);

		// Everything except the negotiated roots falls through to assets (+ _headers).
		if (url.pathname !== "/" && url.pathname !== "/uninstall" && url.pathname !== "/update") {
			return env.ASSETS.fetch(request);
		}

		if (wantsHtml(request)) {
			// Browser → the inspect page. Set the inspect-page security headers explicitly (a
			// worker response does not inherit _headers), authoritative for the bare "/".
			//
			// Fetch the CANONICAL "/" — NOT "/index.html". Cloudflare Pages auto-canonicalizes
			// "/index.html" to "/" with a 308 redirect (empty body). This worker rebuilds the
			// response headers from scratch below and would DROP that redirect's Location, so a
			// browser received a 308 pointing nowhere and rendered a blank white page. "/" serves
			// index.html directly with a 200. As belt-and-suspenders, follow one redirect if the
			// asset pipeline still returns a 3xx.
			let assetResp = await env.ASSETS.fetch(new Request(new URL("/", url), request));
			if (assetResp.status >= 300 && assetResp.status < 400) {
				const location = assetResp.headers.get("Location");
				if (location) {
					assetResp = await env.ASSETS.fetch(new Request(new URL(location, url), request));
				}
			}
			return new Response(assetResp.body, {
				status: assetResp.status,
				headers: {
					"Content-Type": "text/html; charset=utf-8",
					"X-Content-Type-Options": "nosniff",
					"X-Frame-Options": "DENY",
					"Referrer-Policy": "no-referrer",
					"Content-Security-Policy": INSPECT_CSP,
					"Cache-Control": "public, max-age=300",
				},
			});
		}

		if (url.pathname === "/uninstall") {
			// Shell client on /uninstall -> stream uninstall.sh as plain text.
			const uninstallResp = await env.ASSETS.fetch(new Request(new URL("/uninstall.sh", url), request));
			return new Response(uninstallResp.body, {
				status: uninstallResp.status,
				headers: {
					"Content-Type": "text/plain; charset=utf-8",
					"X-Content-Type-Options": "nosniff",
					"Cache-Control": "public, max-age=300",
				},
			});
		}

		if (url.pathname === "/update") {
			// Shell client on /update -> stream update.sh as plain text. A faithful copy of the
			// /uninstall branch: no combo/prefix logic, so the served bytes are byte-identical to
			// the checksummed update.sh (what SHA256SUMS covers).
			const updateResp = await env.ASSETS.fetch(new Request(new URL("/update.sh", url), request));
			return new Response(updateResp.body, {
				status: updateResp.status,
				headers: {
					"Content-Type": "text/plain; charset=utf-8",
					"X-Content-Type-Options": "nosniff",
					"Cache-Control": "public, max-age=300",
				},
			});
		}

		// Shell client on / -> stream install.sh as plain text so `| sh` works.
		const assetResp = await env.ASSETS.fetch(new Request(new URL("/install.sh", url), request));

		const combo = COMBO_PRESETS[(url.searchParams.get("combo") || "").trim()];
		if (combo !== undefined) {
			const body = await assetResp.text();
			const prefix =
				`# --- combo=${escapeForComment(url.searchParams.get("combo"))} preset injected by get.theapiary.sh (PRD-002a sugar; not covered by SHA256SUMS) ---\n` +
				`export HONEYCOMB_INSTALL_PRODUCTS="${escapeForShellDoubleQuotes(combo.products)}"\n` +
				(combo.profile ? `export HONEYCOMB_INSTALL_PROFILE="${escapeForShellDoubleQuotes(combo.profile)}"\n` : "") +
				"# --- end combo preset ---\n";
			return new Response(prefix + body, {
				status: assetResp.status,
				headers: {
					"Content-Type": "text/plain; charset=utf-8",
					"X-Content-Type-Options": "nosniff",
					// Never cache a combo-prefixed response under the plain "/" cache key.
					"Cache-Control": "no-store",
				},
			});
		}

		// Re-wrap to GUARANTEE the content-type a pipe needs, regardless of asset defaults.
		return new Response(assetResp.body, {
			status: assetResp.status,
			headers: {
				"Content-Type": "text/plain; charset=utf-8",
				"X-Content-Type-Options": "nosniff",
				"Cache-Control": "public, max-age=300",
			},
		});
	},
};

// The preset table only ever supplies KNOWN, hardcoded values, but both are escaped defensively so
// a future careless preset edit can never break out of the double-quoted shell assignment.
function escapeForShellDoubleQuotes(value) {
	return String(value).replace(/(["\\$`])/g, "\\$1");
}

function escapeForComment(value) {
	return String(value).replace(/[^A-Za-z0-9._-]/g, "");
}

// A request "wants HTML" only when it is an actual browser navigation: Accept lists text/html AND
// it is not a known CLI user-agent. curl/wget/fetch send `Accept: */*` (or omit it), so the default
// routes them to the script — exactly the rustup/pnpm behavior.
function wantsHtml(request) {
	const ua = (request.headers.get("User-Agent") || "").toLowerCase();
	if (/\b(curl|wget|fetch|libcurl|powershell|httpie|python-requests)\b/.test(ua)) {
		return false;
	}
	const accept = request.headers.get("Accept") || "";
	return accept.includes("text/html");
}
