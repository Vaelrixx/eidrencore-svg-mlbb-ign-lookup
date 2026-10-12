"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Code2, Copy, ExternalLink, FileJson, ShieldCheck, Terminal } from "lucide-react";
import { ConsoleFrame } from "@/components/console-frame";

const baseUrl = "https://nexus-mlbb-ign-lookup-production.up.railway.app";
const curlExample = "curl -X POST \"" + baseUrl + "/api/lookup\" -H \"Content-Type: application/json\" -H \"Authorization: Bearer eid_YOUR_API_KEY\" -d '{\"playerId\":\"123456789\",\"zoneId\":\"1234\"}'";
const supercellCurlExample = [
  "# Brawl Stars",
  `curl -X POST "${baseUrl}/api/lookup/brawl-stars" -H "Content-Type: application/json" -H "Authorization: Bearer eid_YOUR_API_KEY" -d '{"tag":"#2PP"}'`,
  "",
  "# Clash of Clans",
  `curl -X POST "${baseUrl}/api/lookup/clash-of-clans" -H "Content-Type: application/json" -H "Authorization: Bearer eid_YOUR_API_KEY" -d '{"tag":"#2PP"}'`,
  "",
  "# Clash Royale",
  `curl -X POST "${baseUrl}/api/lookup/clash-royale" -H "Content-Type: application/json" -H "Authorization: Bearer eid_YOUR_API_KEY" -d '{"tag":"#C0G20PR2"}'`,
].join("\n");
const supercellTsExample = [
  "import { createEidrenClient, EidrenApiError } from \"./eidren-client\";",
  "",
  "const eidren = createEidrenClient(process.env.EIDREN_API_KEY!);",
  "",
  "try {",
  "  const bs = await eidren.lookupBrawlStars(\"#2PP\");",
  "  console.log(`Brawl Stars ${bs.tag} -> ${bs.nickname}`);",
  "  const coc = await eidren.lookupSupercell(\"clash-of-clans\", \"#2PP\");",
  "  console.log(`Clash of Clans ${coc.tag} -> ${coc.nickname}`);",
  "  const cr = await eidren.lookupClashRoyale(\"#C0G20PR2\");",
  "  console.log(`Clash Royale ${cr.tag} -> ${cr.nickname}`);",
  "} catch (error) {",
  "  if (error instanceof EidrenApiError && !error.retryable) {",
  "    console.error(`Not found or invalid: ${error.code}`);",
  "  } else throw error;",
  "}",
].join("\n");
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
    <section className="docs-hero-card"><div className="docs-hero-icon"><Code2 size={23}/></div><div><span className="platform-eyebrow">DEVELOPER DOCUMENTATION</span><h2>Ship your first lookup.</h2><p>Resolve an MLBB nickname from a Player ID and Zone ID. The response contract is stable; the Eidren network keeps lookups fast and reliable.</p><div className="docs-endpoint"><span className="http-method">POST</span><code>/api/lookup</code><button className="icon-button" aria-label="Copy API endpoint" onClick={() => void copy(baseUrl + "/api/lookup", "endpoint")}>{copied === "endpoint" ? <Check size={15}/> : <Copy size={15}/>}</button></div></div></section>
    <div className="docs-grid">
      <section className="console-panel"><div className="console-panel-heading"><div><span className="platform-eyebrow">01 / AUTHENTICATION</span><h2>Use your API key</h2><p>Generate a key in the API Keys section. Keep it on your server.</p></div><span className="console-big-icon"><ShieldCheck size={20}/></span></div><p className="docs-body">Pass the key as a bearer token in the <code>Authorization</code> header. Keys are shown once at creation and are stored as hashes. If a key is exposed, revoke it and create a replacement.</p><Link className="docs-inline-link" href="/dashboard/keys">Manage API keys <ExternalLink size={13}/></Link></section>
      <section className="console-panel"><div className="console-panel-heading"><div><span className="platform-eyebrow">02 / INPUT</span><h2>Required fields</h2><p>Send a JSON object with both identifiers.</p></div><span className="console-big-icon"><FileJson size={20}/></span></div><div className="docs-field-list"><div><code>playerId</code><span>String · 4–20 digits</span></div><div><code>zoneId</code><span>String · 1–10 digits</span></div></div><p className="docs-body">Identifiers are treated as strings to preserve exact values and leading zeroes. Do not send account passwords or session credentials.</p></section>
    </div>
    <section className="console-panel"><div className="console-panel-heading"><div><span className="platform-eyebrow">03 / QUICKSTART</span><h2>cURL</h2><p>Run from a trusted terminal. Replace the example IDs and API key.</p></div><button className="quiet-button" onClick={() => void copy(curlExample, "curl")}>{copied === "curl" ? <Check size={14}/> : <Copy size={14}/>} {copied === "curl" ? "Copied" : "Copy example"}</button></div><pre className="docs-code"><code>{curlExample}</code></pre></section>
    <section className="console-panel"><div className="console-panel-heading"><div><span className="platform-eyebrow">04 / NODE.JS</span><h2>Server-side JavaScript</h2><p>Keep your API key in a server environment variable, never in browser code.</p></div><button className="quiet-button" onClick={() => void copy(jsExample, "js")}>{copied === "js" ? <Check size={14}/> : <Copy size={14}/>} {copied === "js" ? "Copied" : "Copy example"}</button></div><pre className="docs-code"><code>{jsExample}</code></pre></section>
    <section className="console-panel"><div className="console-panel-heading"><div><span className="platform-eyebrow">05 / RESPONSES</span><h2>Handle errors predictably</h2><p>All API errors return a stable error code and a request correlation ID when applicable.</p></div><span className="console-big-icon"><Terminal size={20}/></span></div><div className="docs-errors"><div><code>INVALID_INPUT</code><span>Malformed JSON or missing fields</span></div><div><code>INVALID_ID</code><span>IDs do not match the numeric format</span></div><div><code>INVALID_API_KEY</code><span>Key is invalid or revoked</span></div><div><code>RATE_LIMITED</code><span>Retry after the provided Retry-After duration</span></div><div><code>SERVICE_UNAVAILABLE</code><span>Eidren could not verify the ID right now — retry shortly</span></div><div><code>PLAYER_NOT_FOUND</code><span>Eidren confirmed the ID was not found</span></div></div></section>
    <section className="console-panel"><div className="console-panel-heading"><div><span className="platform-eyebrow">06 / SUPERCELL GAMES</span><h2>Brawl Stars, Clash of Clans, Clash Royale</h2><p>Resolve a player name from a Supercell player tag. Same keys, quota, and billing.</p></div><button className="quiet-button" onClick={() => void copy(supercellCurlExample, "supercell")}>{copied === "supercell" ? <Check size={14}/> : <Copy size={14}/>} {copied === "supercell" ? "Copied" : "Copy example"}</button></div><div className="docs-field-list"><div><code>POST /api/lookup/brawl-stars</code><span>Brawl Stars · body: {"{ \"tag\": \"#2PP\" }"}</span></div><div><code>POST /api/lookup/clash-of-clans</code><span>Clash of Clans · body: {"{ \"tag\": \"#2PP\" }"}</span></div><div><code>POST /api/lookup/clash-royale</code><span>Clash Royale · body: {"{ \"tag\": \"#C0G20PR2\" }"}</span></div></div><p className="docs-body">Tags use Supercell&apos;s 0289PYLQGRJCUV alphabet and are case-insensitive. A missing tag returns <code>INVALID_TAG</code>; an unknown tag returns <code>BS_PLAYER_NOT_FOUND</code>, <code>COC_PLAYER_NOT_FOUND</code>, or <code>CR_PLAYER_NOT_FOUND</code>. If a game is temporarily offline, the endpoint returns <code>SERVICE_UNAVAILABLE</code> (502).</p><pre className="docs-code"><code>{supercellCurlExample}</code></pre></section>
    <section className="console-panel">
      <div className="console-panel-heading"><div><span className="platform-eyebrow">07 / IDENTITY GAMES</span><h2>Five more player lookup routes</h2><p>These routes use the same Eidren API keys, quota, and billing. See the repository&apos;s <code>docs/identity-lookups.md</code> for complete examples.</p></div></div>
      <div className="docs-field-list">
        <div><code>POST /api/lookup/pubg-mobile</code><span>PUBG Mobile Global · body: {"{ \"playerId\": \"5204837417\" }"}</span></div>
        <div><code>POST /api/lookup/call-of-duty-mobile</code><span>Call of Duty: Mobile (Garena) · body: {"{ \"playerId\": \"8370310025568788000\" }"}</span></div>
        <div><code>POST /api/lookup/valorant</code><span>VALORANT · body: {"{ \"name\": \"ucup\", \"tag\": \"123\" }"}</span></div>
        <div><code>POST /api/lookup/genshin-impact</code><span>Genshin Impact · body: {"{ \"playerId\": \"844335555\", \"server\": \"asia\" }"}</span></div>
        <div><code>POST /api/lookup/honor-of-kings</code><span>Honor of Kings · body: {"{ \"playerId\": \"17960996468644334000\" }"}</span></div>
      </div>
      <p className="docs-body">Send numeric-looking account IDs as JSON strings; Honor of Kings IDs can exceed JavaScript&apos;s safe integer range. Genshin requires a server value: <code>asia</code>, <code>america</code>, <code>europa</code>, or <code>china</code>. The VALORANT route accepts Riot ID name and tag separately. The Call of Duty route is Garena-specific.</p>
      <Link className="docs-inline-link" href="/dashboard/playground">Try the game tools in the playground <ExternalLink size={13}/></Link>
    </section>
    <section className="console-panel"><div className="console-panel-heading"><div><span className="platform-eyebrow">08 / TYPESCRIPT</span><h2>Typed client for all supported games</h2><p>Copy <code>examples/typescript/eidren-client.ts</code> from the repository. No dependencies, Node 18+.</p></div><button className="quiet-button" onClick={() => void copy(supercellTsExample, "supercell-ts")}>{copied === "supercell-ts" ? <Check size={14}/> : <Copy size={14}/>} {copied === "supercell-ts" ? "Copied" : "Copy example"}</button></div><pre className="docs-code"><code>{supercellTsExample}</code></pre><p className="docs-body">The client throws <code>EidrenApiError</code> with <code>status</code>, <code>code</code>, <code>requestId</code>, and <code>retryAfterSeconds</code>. Check <code>error.retryable</code> before retrying: not-found and invalid-input errors never are. Full examples live in <code>examples/typescript/</code>.</p></section>
    <section className="console-callout"><ShieldCheck size={19}/><div><strong>Independent identity network</strong><p>Eidren is not affiliated with Moonton or Supercell. Temporary outages are never treated as proof that an account does not exist.</p></div></section>
  </ConsoleFrame>;
}
