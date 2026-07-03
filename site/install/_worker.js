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
// It only special-cases GET "/" for script-vs-page content negotiation (the get.pnpm.io /
// sh.rustup.rs pattern):
//   GET / from a SHELL client (curl/wget/fetch)      → install.sh as text/plain, so `| sh` works.
//   GET / from a BROWSER (Accept: text/html)         → the human "inspect before piping" page.
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

		// Everything except the bare root falls through to the static asset pipeline (+ _headers).
		if (url.pathname !== "/") {
			return env.ASSETS.fetch(request);
		}

		if (wantsHtml(request)) {
			// Browser → the inspect page. Set the inspect-page security headers explicitly (a
			// worker response does not inherit _headers), authoritative for the bare "/".
			const assetResp = await env.ASSETS.fetch(new Request(new URL("/index.html", url), request));
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

		// Shell client → stream the canonical install.sh as plain text so `| sh` works.
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
