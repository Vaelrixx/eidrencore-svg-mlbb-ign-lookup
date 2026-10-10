const baseUrl = "https://nexus-mlbb-ign-lookup-production.up.railway.app";
const curlExample = "curl -X POST \"" + baseUrl + "/api/lookup\" -H \"Content-Type: application/json\" -H \"Authorization: Bearer eid_YOUR_API_KEY\" -d '{\"playerId\":\"123456789\",\"zoneId\":\"1234\"}'";
const jsExample = [
  "const response = await fetch(\"" + baseUrl + "/api/lookup\", {",
  "  method: \"POST\",",
  "  headers: {",
  "    \"Content-Type\": \"application/json\",",
  "    \"Authorization\": \"Bearer \" + process.env.EIDREN_API_KEY,",
  "  },",
  "  body: JSON.stringify({ playerId: \"123456789\", zoneId: \"1234\" }),",
  "});",
  "const result = await response.json();",
  "if (result.success) console.log(result.data.nickname);",
  "else console.error(result.code, result.error);",
].join("\n");

export default function DocsPage() {
  const [copied, setCopied] = useState("");
  async function copy(value: string, label: string) {
    try { await navigator.clipboard.writeText(value); setCopied(label); window.setTimeout(() => setCopied(""), 1500); }
    catch { setCopied("unavailable"); }
  }
  return <ConsoleFrame>
    <section className="docs-hero-card"><div className="docs-hero-icon"><Code2 size={23}/></div><div><span className="platform-eyebrow">DEVELOPER DOCUMENTATION</span><h2>Ship your first lookup.</h2><p>Resolve an MLBB nickname from a Player ID and Zone ID. The response contract is stable; provider availability may vary because lookup sources are unofficial.</p><div className="docs-endpoint"><span className="http-method">POST</span><code>/api/lookup</code><button className="icon-button" aria-label="Copy API endpoint" onClick={() => void copy(baseUrl + "/api/lookup", "endpoint")}>{copied === "endpoint" ? <Check size={15}/> : <Copy size={15}/>}</button></div></div></section>
    <div className="docs-grid">
      <section className="console-panel"><div className="console-panel-heading"><div><span className="platform-eyebrow">01 / AUTHENTICATION</span><h2>Use your API key</h2><p>Generate a key in the API Keys section. Keep it on your server.</p></div><span className="console-big-icon"><ShieldCheck size={20}/></span></div><p className="docs-body">Pass the key as a bearer token in the <code>Authorization</code> header. Keys are shown once at creation and are stored as hashes. If a key is exposed, revoke it and create a replacement.</p><Link className="docs-inline-link" href="/dashboard/keys">Manage API keys <ExternalLink size={13}/></Link></section>
      <section className="console-panel"><div className="console-panel-heading"><div><span className="platform-eyebrow">02 / INPUT</span><h2>Required fields</h2><p>Send a JSON object with both identifiers.</p></div><span className="console-big-icon"><FileJson size={20}/></span></div><div className="docs-field-list"><div><code>playerId</code><span>String · 4–20 digits</span></div><div><code>zoneId</code><span>String · 1–10 digits</span></div></div><p className="docs-body">Identifiers are treated as strings to preserve exact values and leading zeroes. Do not send account passwords or session credentials.</p></section>
    </div>
    <section className="console-panel"><div className="console-panel-heading"><div><span className="platform-eyebrow">03 / QUICKSTART</span><h2>cURL</h2><p>Run from a trusted terminal. Replace the example IDs and API key.</p></div><button className="quiet-button" onClick={() => void copy(curlExample, "curl")}>{copied === "curl" ? <Check size={14}/> : <Copy size={14}/>} {copied === "curl" ? "Copied" : "Copy example"}</button></div><pre className="docs-code"><code>{curlExample}</code></pre></section>
    <section className="console-panel"><div className="console-panel-heading"><div><span className="platform-eyebrow">04 / NODE.JS</span><h2>Server-side JavaScript</h2><p>Keep your API key in a server environment variable, never in browser code.</p></div><button className="quiet-button" onClick={() => void copy(jsExample, "js")}>{copied === "js" ? <Check size={14}/> : <Copy size={14}/>} {copied === "js" ? "Copied" : "Copy example"}</button></div><pre className="docs-code"><code>{jsExample}</code></pre></section>
    <section className="console-panel"><div className="console-panel-heading"><div><span className="platform-eyebrow">05 / RESPONSES</span><h2>Handle errors predictably</h2><p>All API errors return a stable error code and a request correlation ID when applicable.</p></div><span className="console-big-icon"><Terminal size={20}/></span></div><div className="docs-errors"><div><code>INVALID_INPUT</code><span>Malformed JSON or missing fields</span></div><div><code>INVALID_ID</code><span>IDs do not match the numeric format</span></div><div><code>INVALID_API_KEY</code><span>Key is invalid or revoked</span></div><div><code>RATE_LIMITED</code><span>Retry after the provided Retry-After duration</span></div><div><code>UPSTREAM_UNAVAILABLE</code><span>Lookup providers did not return a reliable result</span></div><div><code>PLAYER_NOT_FOUND</code><span>A provider explicitly confirmed the ID was not found</span></div></div></section>
    <section className="console-callout"><ShieldCheck size={19}/><div><strong>Unofficial community API</strong><p>Eidren is not affiliated with Moonton. Third-party lookup providers may change, rate-limit, or become unavailable. Provider outages are not treated as proof that an account does not exist.</p></div></section>
  </ConsoleFrame>;
}
