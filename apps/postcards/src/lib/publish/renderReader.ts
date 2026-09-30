// Render a PUBLISHED journey to ONE self-contained HTML document. Two readers,
// same data and same guarantees, chosen with `opts.layout`:
//   • "blog" (DEFAULT) — a LIVING travelogue: one long scrollable page with a
//     masthead, a "Last updated" stamp, a jump-to-newest link, the labeled route
//     map, and a dated feed of posts (one per step, chronological, each with a
//     stable permalink). Made to re-publish over time and re-read; returning
//     visitors find what's new.
//   • "book" — the original paged reader: an editorial cover, the route map, and
//     one photo-led page per step, paged left→right, read once end-to-end.
//
// Constitution guarantees baked into this output:
//   • INERT — all story text and captions are placed with textContent (never
//     innerHTML), map labels are escaped, and the embedded JSON escapes "<" so it
//     can never break the <script> boundary. A shared page can't form raw HTML, a
//     script, or a tracking pixel.
//   • PRIVATE / OFFLINE — everything (CSS, JS, data, photos, the map) is inlined.
//     There is NO external URL of any kind: no CDN, no web font (system stack
//     only), no map tile, no analytics, and the inline SVG carries no xmlns URL.
//     The reader makes ZERO network requests and leaks nothing.
//   • ZERO-KNOWLEDGE PASSPHRASE — when `opts.encrypted` is given instead of a
//     plain journey, only the AES-GCM envelope ships. A tiny inline decrypt
//     routine (same PBKDF2-SHA256 + AES-GCM scheme as encrypt.ts) unlocks it in
//     the visitor's browser; the passphrase is never written to the file.
//
// This module is PURE: `renderReaderHtml(journey, opts?)` returns a string and
// touches no I/O, no DOM, no globals — it is unit-tested for self-containment.

import type { PublishedJourney } from "./bundle";
import type { EncryptedEnvelope } from "./encrypt";
import { LAND_OUTLINE } from "./landOutline";

export interface RenderReaderOptions {
  /** When set, the reader ships this envelope instead of a plain journey and
   *  gates on a passphrase. Pass `journey: null` in this mode — the plaintext
   *  must NOT be in the file. */
  encrypted?: EncryptedEnvelope;
  /** Attribution line for the map/reference data (kept visible per dataset
   *  licenses). Defaults to the app's Natural Earth / OpenStreetMap / GeoNames
   *  credit. Plain text only — never a link (offline, zero external requests). */
  attribution?: string;
  /**
   * How the reader presents the journey.
   *   • "blog" (default) — a LIVING travelogue: one long vertical, scrollable page
   *     with a masthead, a "last updated" stamp, a jump-to-newest link, the map,
   *     and a dated feed of posts (one per step). Made to re-publish over time and
   *     be re-read; returning visitors find what's new.
   *   • "book" — the original paged "book": a cover, a map, and one page per stop,
   *     turned left→right, read once end-to-end.
   * Both variants stay fully self-contained (inline only) and injection-safe.
   */
  layout?: "blog" | "book";
}

/** Default credit for the reference data behind the coordinates and outline. */
const DEFAULT_ATTRIBUTION =
  "Coordinates from GeoNames (CC BY 4.0). Outline data © Natural Earth / OpenStreetMap contributors.";

/** HTML-escape text destined for markup (title tag, static labels, footer). */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Serialize a value as JSON safe to drop inside a <script type="application/json">
 * block: escape "<", ">", "&" and the U+2028/U+2029 line separators to their
 * \uXXXX forms. JSON.parse decodes them back, so the data is unchanged — but the
 * text can never close the script element or smuggle markup (inert by design).
 */
function jsonForScript(v: unknown): string {
  return JSON.stringify(v)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    // U+2028 / U+2029 are legal in JSON strings but terminate an inline script.
    .replace(/[\u2028\u2029]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
}

// ---------------------------------------------------------------------------
// Inline styles — an editorial "paper & ink" travel-blog look. Theme-aware
// (light + dark via prefers-color-scheme, with an explicit toggle), accessible
// focus rings, reduced-motion honoured. Self-hostable fonts only: a refined
// system serif for display and a humanist system sans for body — no web font,
// no external asset of any kind.
// ---------------------------------------------------------------------------
const READER_CSS = `
:root{
  --pc-serif:Georgia,"Iowan Old Style","Palatino Linotype",Palatino,"Book Antiqua","Times New Roman",serif;
  --pc-sans:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  --pc-bg:#f6f1e7; --pc-surface:#fffdf8; --pc-elev:#efe7d6;
  --pc-text:#241f18; --pc-muted:#6c6354; --pc-border:#e5dcc8;
  --pc-accent:#a4381c; --pc-accent-ink:#fff7ef; --pc-gold:#8a6a2c;
  --pc-ocean:#d9e6f1; --pc-map-paper:#eef1e5; --pc-map-ink:#3b392f; --pc-map-grat:#bcc7d3;
  --pc-map-coast:#b9c2ab;
  color-scheme:light;
}
@media (prefers-color-scheme:dark){
  :root:not([data-theme="light"]){
    --pc-bg:#15130f; --pc-surface:#1d1a15; --pc-elev:#26211a;
    --pc-text:#efe8da; --pc-muted:#a89e8b; --pc-border:#332d22;
    --pc-accent:#e3855d; --pc-accent-ink:#1b130d; --pc-gold:#cba85f;
    --pc-ocean:#0f1d2a; --pc-map-paper:#20271d; --pc-map-ink:#d6d1c2; --pc-map-grat:#243243;
    --pc-map-coast:#3a462f;
    color-scheme:dark;
  }
}
:root[data-theme="dark"]{
  --pc-bg:#15130f; --pc-surface:#1d1a15; --pc-elev:#26211a;
  --pc-text:#efe8da; --pc-muted:#a89e8b; --pc-border:#332d22;
  --pc-accent:#e3855d; --pc-accent-ink:#1b130d; --pc-gold:#cba85f;
  --pc-ocean:#0f1d2a; --pc-map-paper:#20271d; --pc-map-ink:#d6d1c2; --pc-map-grat:#243243;
  --pc-map-coast:#3a462f;
  color-scheme:dark;
}
*{box-sizing:border-box}
html,body{margin:0;height:100%}
body{
  background:var(--pc-bg); color:var(--pc-text);
  font-family:var(--pc-sans); line-height:1.62; -webkit-text-size-adjust:100%;
}
.pc-shell{min-height:100%; display:flex; flex-direction:column}
.pc-app{flex:1; width:100%; max-width:720px; margin:0 auto; padding:0 20px 104px; position:relative}
.pc-loading{color:var(--pc-muted); text-align:center; padding:56px 0; font-style:italic}
.pc-noscript{max-width:520px; margin:56px auto; padding:18px 20px; border:1px solid var(--pc-border);
  background:var(--pc-surface); border-radius:14px; text-align:center}
:focus-visible{outline:3px solid var(--pc-accent); outline-offset:3px; border-radius:6px}

/* Small caps eyebrow / kicker used across cover, map, steps */
.pc-kicker{margin:0 0 10px; font-size:12px; font-weight:700; letter-spacing:.22em;
  text-transform:uppercase; color:var(--pc-accent)}
.pc-folio{margin:34px 0 0; text-align:center; font-size:12px; letter-spacing:.32em;
  color:var(--pc-muted); font-variant-numeric:tabular-nums}

/* Header: progress + counter + theme toggle */
.pc-head{position:sticky; top:0; z-index:5; display:flex; align-items:center; gap:12px;
  padding:12px 16px; background:color-mix(in srgb, var(--pc-bg) 86%, transparent);
  backdrop-filter:saturate(1.2) blur(7px); border-bottom:1px solid var(--pc-border)}
.pc-progress{flex:1; height:5px; background:var(--pc-border); border-radius:99px; overflow:hidden}
.pc-progress-bar{height:100%; width:0; background:var(--pc-accent); transition:width .3s ease}
.pc-counter{font-size:13px; color:var(--pc-muted); font-variant-numeric:tabular-nums; white-space:nowrap}
.pc-theme{border:1px solid var(--pc-border); background:var(--pc-surface); color:var(--pc-text);
  border-radius:99px; width:34px; height:34px; font-size:16px; cursor:pointer; line-height:1}
.pc-theme:hover{background:var(--pc-elev)}

/* Spreads */
.pc-spread{padding:30px 2px 8px; animation:pc-in .32s ease both}
.pc-spread[hidden]{display:none}
@keyframes pc-in{from{opacity:0; transform:translateX(16px)} to{opacity:1; transform:none}}

/* Cover */
.pc-cover{text-align:center; padding-top:22px}
.pc-cover-hero{position:relative; width:100%; aspect-ratio:16/10; margin:0 0 26px;
  border-radius:18px; overflow:hidden; background:var(--pc-elev); border:1px solid var(--pc-border);
  box-shadow:0 18px 40px -24px rgba(0,0,0,.5)}
.pc-cover-hero img{width:100%; height:100%; object-fit:cover; display:block}
.pc-cover-hero.is-empty{display:flex; align-items:center; justify-content:center;
  background:radial-gradient(120% 120% at 30% 20%, var(--pc-elev), var(--pc-surface))}
.pc-cover-hero-glyph{font-size:64px; opacity:.6}
.pc-cover-title{font-family:var(--pc-serif); font-weight:700; font-size:clamp(30px,7.6vw,50px);
  line-height:1.08; letter-spacing:-.01em; margin:0 0 12px}
.pc-cover-sub{font-family:var(--pc-serif); font-style:italic; font-size:19px; color:var(--pc-muted); margin:0 0 8px}
.pc-cover-dates{font-size:13px; letter-spacing:.14em; text-transform:uppercase; color:var(--pc-muted); margin:0 0 26px}
.pc-totals{display:flex; justify-content:center; flex-wrap:wrap; gap:12px}
.pc-total{background:var(--pc-surface); border:1px solid var(--pc-border); border-radius:14px;
  padding:14px 20px; min-width:104px; box-shadow:0 1px 2px rgba(0,0,0,.05)}
.pc-total-n{font-family:var(--pc-serif); font-size:27px; font-weight:700; font-variant-numeric:tabular-nums}
.pc-total-l{font-size:11px; color:var(--pc-muted); text-transform:uppercase; letter-spacing:.1em}
.pc-cover-hint{margin-top:30px; color:var(--pc-muted); font-size:14px; font-style:italic}
.pc-colophon{margin:16px auto 0; max-width:420px; color:var(--pc-muted); font-size:12px;
  padding-top:16px; border-top:1px solid var(--pc-border)}

/* Map */
.pc-mapwrap h2, .pc-step h2{font-family:var(--pc-serif); font-weight:700; font-size:25px; margin:0 0 14px; letter-spacing:-.01em}
.pc-map{position:relative; background:var(--pc-map-paper); border:1px solid var(--pc-border);
  border-radius:16px; overflow:hidden; box-shadow:inset 0 0 60px -30px rgba(0,0,0,.4)}
.pc-map::after{content:""; position:absolute; inset:0; pointer-events:none; border-radius:16px;
  background:radial-gradient(130% 120% at 50% 45%, transparent 58%, rgba(60,45,20,.14))}
.pc-map-svg{display:block; width:100%; height:auto}
.pc-map-bg{fill:var(--pc-ocean)}
.pc-land{fill:var(--pc-map-paper); stroke:var(--pc-map-coast); stroke-width:.8; stroke-linejoin:round}
.pc-grat line{stroke:var(--pc-map-grat); stroke-width:.6; opacity:.7}
.pc-leg{fill:none; stroke-width:2.4; stroke-linecap:round}
.pc-leg-halo{fill:none; stroke:var(--pc-map-paper); stroke-width:5.2; stroke-linecap:round; opacity:.85}
.pc-pt{fill:var(--pc-accent); stroke:var(--pc-map-paper); stroke-width:1.4}
.pc-pt-ring{fill:none; stroke:var(--pc-map-ink); stroke-width:1.4; opacity:.45}
.pc-map-label{font-family:var(--pc-sans); font-size:11.5px; font-weight:600; fill:var(--pc-map-ink);
  paint-order:stroke; stroke:var(--pc-map-paper); stroke-width:3px; stroke-linejoin:round; stroke-linecap:round}
.pc-compass-face{fill:var(--pc-map-paper); stroke:var(--pc-map-ink); stroke-width:1; opacity:.85}
.pc-compass-n{fill:var(--pc-accent)}
.pc-compass-s{fill:var(--pc-map-ink); opacity:.55}
.pc-compass-label{font-family:var(--pc-sans); font-size:10px; font-weight:700; fill:var(--pc-map-ink)}
.pc-legend{display:flex; flex-wrap:wrap; gap:9px 16px; margin:14px 2px 0; font-size:13px; color:var(--pc-muted)}
.pc-legend span{display:inline-flex; align-items:center; gap:7px}
.pc-swatch{width:18px; height:3px; border-radius:2px; display:inline-block}
.pc-dot{width:11px; height:11px; border-radius:99px; display:inline-block; border:1.5px solid var(--pc-map-paper)}
.pc-attrib{margin:14px 2px 0; font-size:12px; color:var(--pc-muted)}

/* Step page */
.pc-hero{position:relative; width:100%; aspect-ratio:3/2; border-radius:16px; overflow:hidden;
  background:var(--pc-elev); border:1px solid var(--pc-border); box-shadow:0 14px 34px -24px rgba(0,0,0,.5)}
.pc-hero img{width:100%; height:100%; object-fit:cover; display:block}
.pc-hero-empty{display:flex; align-items:center; justify-content:center; height:100%;
  background:radial-gradient(120% 120% at 30% 20%, var(--pc-elev), var(--pc-surface)); flex-direction:column; gap:8px}
.pc-hero-empty .pc-flag{font-size:56px}
.pc-hero-empty .pc-place{color:var(--pc-muted); font-size:15px; font-style:italic}
.pc-badge{position:absolute; top:12px; left:12px; background:var(--pc-accent); color:var(--pc-accent-ink);
  border-radius:99px; padding:6px 13px; font-size:13px; font-weight:600; display:inline-flex; align-items:center; gap:6px;
  box-shadow:0 2px 8px rgba(0,0,0,.25)}
.pc-step-meta{display:flex; align-items:baseline; flex-wrap:wrap; gap:6px 12px; margin:18px 0 4px}
.pc-step h2{margin:0}
.pc-step-date{color:var(--pc-muted); font-size:14px; letter-spacing:.06em; text-transform:uppercase}
.pc-story-title{font-family:var(--pc-serif); font-size:19px; font-weight:700; margin:18px 0 6px}
.pc-story-text{white-space:pre-wrap; margin:0; font-size:16.5px; line-height:1.72}
.pc-gallery{display:grid; grid-template-columns:repeat(auto-fill,minmax(96px,1fr)); gap:8px; margin-top:20px}
.pc-thumb{padding:0; border:1px solid var(--pc-border); border-radius:10px; overflow:hidden; cursor:pointer;
  background:var(--pc-elev); aspect-ratio:1; display:block}
.pc-thumb img{width:100%; height:100%; object-fit:cover; display:block}

/* Nav */
.pc-nav{position:fixed; left:0; right:0; bottom:0; display:flex; justify-content:center; gap:12px;
  padding:12px 16px calc(12px + env(safe-area-inset-bottom)); background:color-mix(in srgb, var(--pc-bg) 86%, transparent);
  backdrop-filter:blur(7px); border-top:1px solid var(--pc-border)}
.pc-btn{border:1px solid var(--pc-border); background:var(--pc-surface); color:var(--pc-text);
  border-radius:99px; padding:10px 22px; font-size:15px; font-weight:600; cursor:pointer; min-width:122px}
.pc-btn:hover:not(:disabled){background:var(--pc-elev)}
.pc-btn:disabled{opacity:.4; cursor:default}
.pc-btn-primary{background:var(--pc-accent); color:var(--pc-accent-ink); border-color:transparent}

/* Passphrase gate */
.pc-gate{max-width:420px; margin:64px auto 0; text-align:center}
.pc-gate-title{font-family:var(--pc-serif); font-size:26px; margin:0 0 8px}
.pc-gate-note{color:var(--pc-muted); margin:0 0 22px}
.pc-gate-label{display:block; text-align:left; font-size:13px; color:var(--pc-muted); margin-bottom:16px}
.pc-gate-input{width:100%; margin-top:6px; padding:12px 14px; font-size:16px; border-radius:12px;
  border:1px solid var(--pc-border); background:var(--pc-surface); color:var(--pc-text)}
.pc-gate-msg{color:var(--pc-accent); min-height:22px; margin:16px 0 0; font-weight:600}

/* ---- Blog layout (the living travelogue, DEFAULT) ------------------------ */
.pc-head-blog{justify-content:space-between}
.pc-blog-brand{flex:1; min-width:0; font-family:var(--pc-serif); font-weight:700; font-size:15px;
  letter-spacing:.01em; color:var(--pc-text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
.pc-blog{padding:6px 0 0}
.pc-masthead{padding:30px 0 4px; border-bottom:1px solid var(--pc-border); margin:0 0 8px}
.pc-blog-title{font-family:var(--pc-serif); font-weight:700; font-size:clamp(32px,7.6vw,52px);
  line-height:1.05; letter-spacing:-.015em; margin:6px 0 12px}
.pc-blog-sub{font-family:var(--pc-serif); font-style:italic; font-size:19px; color:var(--pc-muted); margin:0 0 12px}
.pc-blog-dates{font-size:13px; letter-spacing:.14em; text-transform:uppercase; color:var(--pc-muted); margin:0 0 16px}
.pc-updated{display:inline-flex; align-items:center; gap:8px; margin:0 6px 18px 0; font-size:13px; font-weight:600;
  color:var(--pc-gold); background:color-mix(in srgb, var(--pc-gold) 12%, transparent);
  border:1px solid color-mix(in srgb, var(--pc-gold) 32%, transparent); padding:6px 13px; border-radius:99px}
.pc-updated-dot{width:8px; height:8px; border-radius:99px; background:var(--pc-gold);
  box-shadow:0 0 0 3px color-mix(in srgb, var(--pc-gold) 22%, transparent)}
.pc-latest{display:flex; align-items:center; gap:11px; text-decoration:none; color:var(--pc-text);
  background:var(--pc-surface); border:1px solid var(--pc-border); border-radius:14px; padding:12px 15px;
  font-weight:600; margin:0 0 8px; box-shadow:0 1px 2px rgba(0,0,0,.04)}
.pc-latest:hover{background:var(--pc-elev)}
.pc-latest-tag{flex:none; font-size:11px; font-weight:700; letter-spacing:.16em; text-transform:uppercase;
  color:var(--pc-accent); background:color-mix(in srgb, var(--pc-accent) 12%, transparent);
  padding:4px 9px; border-radius:99px}
.pc-latest-title{font-family:var(--pc-serif); font-size:17px; min-width:0; overflow:hidden;
  text-overflow:ellipsis; white-space:nowrap}
.pc-latest-arrow{flex:none; margin-left:auto; color:var(--pc-accent)}

/* Map card (blog reuses the labeled route map, without the paged animation) */
.pc-mapcard{margin:22px 0 4px}
.pc-mapcard h2{font-family:var(--pc-serif); font-weight:700; font-size:25px; margin:0 0 14px; letter-spacing:-.01em}

/* The feed of dated posts */
.pc-feed{margin-top:26px}
.pc-post{scroll-margin-top:78px; padding:6px 0 2px; animation:pc-fade .4s ease both}
@keyframes pc-fade{from{opacity:0; transform:translateY(10px)} to{opacity:1; transform:none}}
.pc-post-meta{display:flex; align-items:center; flex-wrap:wrap; gap:9px 12px; margin:0 0 10px}
.pc-post-date{font-size:13px; letter-spacing:.05em; text-transform:uppercase; color:var(--pc-muted);
  font-variant-numeric:tabular-nums}
.pc-post-mode{display:inline-flex; align-items:center; gap:6px; background:var(--pc-accent); color:var(--pc-accent-ink);
  border-radius:99px; padding:4px 11px; font-size:12px; font-weight:600}
.pc-permalink{margin-left:auto; display:inline-flex; align-items:center; gap:7px; text-decoration:none;
  color:var(--pc-muted); border:1px solid var(--pc-border); background:var(--pc-surface); border-radius:99px;
  padding:4px 11px; font-size:12px; line-height:1.4}
.pc-permalink:hover{background:var(--pc-elev); color:var(--pc-text)}
.pc-permalink-note{opacity:0; transition:opacity .2s ease; font-weight:700; color:var(--pc-accent)}
.pc-permalink.is-copied .pc-permalink-note{opacity:1}
.pc-post-place{font-family:var(--pc-serif); font-weight:700; font-size:26px; letter-spacing:-.01em; margin:0 0 4px}
.pc-post-title{font-family:var(--pc-serif); font-style:italic; font-weight:600; font-size:19px;
  color:var(--pc-muted); margin:0 0 14px}
.pc-post-hero{padding:0; width:100%; cursor:pointer; margin:6px 0 0; display:block}
.pc-post .pc-story-text{margin-top:16px}
.pc-post .pc-gallery{margin-top:12px}
.pc-divider{border:0; height:1px; background:var(--pc-border); margin:32px 0; position:relative}
.pc-divider::after{content:"❖"; position:absolute; top:-11px; left:50%; transform:translateX(-50%);
  background:var(--pc-bg); color:var(--pc-gold); padding:0 12px; font-size:13px}

/* Footer */
.pc-foot{max-width:720px; margin:0 auto; padding:22px 20px 96px; color:var(--pc-muted);
  font-size:13px; text-align:center; border-top:1px solid var(--pc-border)}

/* Lightbox */
.pc-lightbox{position:fixed; inset:0; z-index:50; background:rgba(0,0,0,.88); display:flex;
  flex-direction:column; align-items:center; justify-content:center; padding:20px}
.pc-lb-img{max-width:100%; max-height:78vh; object-fit:contain; border-radius:8px}
.pc-lb-cap{color:#f0f0f0; margin-top:12px; font-size:14px; text-align:center; max-width:640px; font-style:italic}
.pc-lb-nav{position:absolute; top:50%; transform:translateY(-50%); background:rgba(255,255,255,.14);
  color:#fff; border:0; font-size:30px; width:52px; height:52px; border-radius:99px; cursor:pointer}
.pc-lb-prev{left:16px} .pc-lb-next{right:16px}
.pc-lb-close{position:absolute; top:16px; right:16px; background:rgba(255,255,255,.14); color:#fff;
  border:0; font-size:16px; padding:8px 14px; border-radius:99px; cursor:pointer}
.pc-lb-count{position:absolute; top:20px; left:16px; color:#ddd; font-size:13px; font-variant-numeric:tabular-nums}
.pc-sr{position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0 0 0 0); border:0}

@media (prefers-reduced-motion:reduce){
  *{animation-duration:.001ms !important; animation-iteration-count:1 !important; transition-duration:.001ms !important}
  .pc-spread{animation:none}
}
`;

// ---------------------------------------------------------------------------
// Inline reader runtime. Written in plain ES5-ish JS with NO backslashes, NO
// backticks and NO "${" so it survives being embedded verbatim in the document
// (and the source template literal below). Emojis are literal characters.
// ---------------------------------------------------------------------------
const READER_JS = `
(function(){
  "use strict";
  var MODE_GLYPH={flight:"✈️",train:"🚆",bus:"🚌",ferry:"⛴️",car:"🚗",other:"•"};
  var MODE_LABEL={flight:"Flight",train:"Train",bus:"Bus",ferry:"Ferry",car:"Car",other:"Travel"};
  var MODE_COLOR={flight:"#4f46e5",train:"#15803d",bus:"#b45309",ferry:"#0369a1",car:"#be185d",other:"#78716c"};
  var START_COLOR="#0e7490", END_COLOR="#b3401f";

  function el(tag,props,kids){
    var e=document.createElement(tag);
    if(props){for(var k in props){var v=props[k];
      if(v==null) continue;
      if(k==="className") e.className=v;
      else if(k==="textContent") e.textContent=v;
      else if(k==="html") e.innerHTML=v;
      else if(k in e){try{e[k]=v;}catch(_e){e.setAttribute(k,String(v));}}
      else e.setAttribute(k,String(v));
    }}
    if(kids){for(var i=0;i<kids.length;i++){var c=kids[i]; if(c==null) continue;
      e.appendChild(typeof c==="string"?document.createTextNode(c):c);}}
    return e;
  }
  function esc(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
  function pad2(n){n=String(n); return n.length<2?"0"+n:n;}
  function fmtInt(n){try{return new Intl.NumberFormat().format(Math.round(n));}catch(_e){return String(Math.round(n));}}
  // A day, a month ("Mar 2024") or a year: a vague trip date keeps its precision.
  // Formatted in UTC so every visitor's zone reads the same day; a day its month
  // lacks is shown as written.
  function fmtDate(iso){
    if(!iso) return "";
    var m=/^([0-9]{4})(?:-([0-9]{2})(?:-([0-9]{2}))?)?$/.exec(iso);
    if(!m) return iso;
    if(!m[2]) return m[1];
    var d=new Date(0); d.setUTCFullYear(+m[1],+m[2]-1,m[3]?+m[3]:1);
    if(d.getUTCMonth()!==+m[2]-1||(m[3]&&d.getUTCDate()!==+m[3])) return iso;
    var opt=m[3]?{dateStyle:"medium",timeZone:"UTC"}:{year:"numeric",month:"short",timeZone:"UTC"};
    try{return new Intl.DateTimeFormat(undefined,opt).format(d);}catch(_e){return iso;}
  }
  function flag(cc){
    if(!cc||cc==="ZZ") return "📍";
    var up=cc.toUpperCase(), out="";
    for(var i=0;i<up.length;i++){var ch=up.charCodeAt(i); if(ch<65||ch>90) return "📍"; out+=String.fromCodePoint(127397+ch);}
    return out;
  }

  // --- decrypt (mirrors encrypt.ts: PBKDF2-SHA256 -> AES-GCM) ---
  function b64(s){var bin=atob(s); var out=new Uint8Array(bin.length); for(var i=0;i<bin.length;i++) out[i]=bin.charCodeAt(i); return out;}
  function deriveKey(pass,salt,iter){
    var enc=new TextEncoder().encode(pass);
    return crypto.subtle.importKey("raw",enc,"PBKDF2",false,["deriveKey"]).then(function(base){
      return crypto.subtle.deriveKey({name:"PBKDF2",salt:salt,iterations:iter,hash:"SHA-256"},base,{name:"AES-GCM",length:256},false,["decrypt"]);
    });
  }
  function decrypt(env,pass){
    var iv=b64(env.iv), ct=b64(env.ct), salt=b64(env.salt);
    // Clamp a tampered iteration count so a hostile file can't hang the visitor's
    // tab (iter: 9e9) or gut the KDF (iter: 1). Mirrors encrypt.ts clampIterations.
    var iter=Math.min(10000000,Math.max(100000,(+env.iter)||250000));
    return deriveKey(pass,salt,iter).then(function(key){
      return crypto.subtle.decrypt({name:"AES-GCM",iv:iv},key,ct);
    }).then(function(buf){ return JSON.parse(new TextDecoder().decode(buf)); });
  }

  // --- route map (inline SVG string; user place names are escaped) ---
  // Fits a Web-Mercator projection to the journey's own bounds so every city
  // spreads out and its label is readable — a travel map, not a world diagram.
  function niceStep(span,target){
    var raw=(span||1)/Math.max(1,target);
    var pw=Math.pow(10,Math.floor(Math.log(raw)/Math.LN10));
    var steps=[1,2,5,10];
    for(var i=0;i<steps.length;i++){ if(steps[i]*pw>=raw) return steps[i]*pw; }
    return 10*pw;
  }
  function mercY(lat){var la=Math.max(-85,Math.min(85,lat)); return Math.log(Math.tan(Math.PI/4+la*Math.PI/360));}
  function invMercY(y){return (2*Math.atan(Math.exp(y))-Math.PI/2)*180/Math.PI;}

  // The embedded world land outline (public-domain Natural Earth, simplified).
  // Parsed once from its inert JSON island; [] if absent, so the map degrades to
  // the plain graticule it drew before.
  var LAND_CACHE=null;
  function readLand(){
    if(LAND_CACHE) return LAND_CACHE;
    try{var e=document.getElementById("pc-land"); LAND_CACHE=e?JSON.parse(e.textContent):[];}
    catch(_e){LAND_CACHE=[];}
    return LAND_CACHE;
  }

  function placeLabel(cx,cy,name,placed,W,H){
    var fs=11.5, w=Math.min(150,(name?name.length:0)*fs*0.56)+6, h=fs+5;
    var cands=[
      {tx:cx+9,ty:cy+4,anchor:"start",bx:cx+7,by:cy-h/2,ex:cx+7+w,ey:cy+h/2},
      {tx:cx-9,ty:cy+4,anchor:"end",bx:cx-7-w,by:cy-h/2,ex:cx-7,ey:cy+h/2},
      {tx:cx,ty:cy-9,anchor:"middle",bx:cx-w/2,by:cy-9-h,ex:cx+w/2,ey:cy-5},
      {tx:cx,ty:cy+16,anchor:"middle",bx:cx-w/2,by:cy+7,ex:cx+w/2,ey:cy+7+h}
    ];
    for(var c=0;c<cands.length;c++){
      var k=cands[c];
      if(k.bx<3||k.ex>W-3||k.by<3||k.ey>H-3) continue;
      var hit=false;
      for(var q=0;q<placed.length;q++){var r=placed[q];
        if(k.bx<r.ex&&k.ex>r.bx&&k.by<r.ey&&k.ey>r.by){hit=true;break;}}
      if(!hit){placed.push(k); return k;}
    }
    placed.push(cands[0]); return cands[0];
  }

  function mapSvg(steps){
    var W=760,H=440,PAD=56;
    var X=[],Y=[];
    for(var i=0;i<steps.length;i++){X.push(steps[i].lon*Math.PI/180); Y.push(mercY(steps[i].lat));}
    var minX=1e9,maxX=-1e9,minY=1e9,maxY=-1e9;
    for(i=0;i<X.length;i++){minX=Math.min(minX,X[i]);maxX=Math.max(maxX,X[i]);minY=Math.min(minY,Y[i]);maxY=Math.max(maxY,Y[i]);}
    if(!isFinite(minX)){minX=-Math.PI;maxX=Math.PI;minY=-1.4;maxY=1.4;}
    // Guarantee a minimum extent so ONE stop (or a tight cluster) shows regional
    // context — its country and coastline — instead of zooming into an empty void.
    // ~0.3 rad ≈ 17° of longitude; the same in Mercator-y units of latitude.
    var MIN_SPAN=0.3;
    if(maxX-minX<MIN_SPAN){var mcx=(minX+maxX)/2; minX=mcx-MIN_SPAN/2; maxX=mcx+MIN_SPAN/2;}
    if(maxY-minY<MIN_SPAN){var mcy=(minY+maxY)/2; minY=mcy-MIN_SPAN/2; maxY=mcy+MIN_SPAN/2;}
    var spanX=(maxX-minX)||0.5, spanY=(maxY-minY)||0.5;
    minX-=spanX*0.18; maxX+=spanX*0.18; minY-=spanY*0.24; maxY+=spanY*0.24;
    spanX=maxX-minX; spanY=maxY-minY;
    var scale=Math.min((W-2*PAD)/spanX,(H-2*PAD)/spanY);
    var midX=(minX+maxX)/2, midY=(minY+maxY)/2;
    function sx(x){return W/2+(x-midX)*scale;}
    function sy(y){return H/2-(y-midY)*scale;}
    function pt(idx){return {x:sx(X[idx]),y:sy(Y[idx])};}

    var s="";
    s+='<svg class="pc-map-svg" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Route map of the journey, showing each city">';
    s+='<rect class="pc-map-bg" x="0" y="0" width="'+W+'" height="'+H+'"/>';

    // Land silhouette behind everything: the embedded, heavily-simplified world
    // outline (offline, no network). Only rings touching the padded viewport are
    // emitted, so a regional view stays a small path. A >180° longitude jump
    // starts a fresh sub-path so a ring near the antimeridian can't streak across.
    var land=readLand(), lp="";
    for(var li=0;li<land.length;li++){
      var ring=land[li], seg="", any=false, prevLon=null;
      for(var pi=0;pi<ring.length;pi++){
        var llon=ring[pi][0], llat=ring[pi][1];
        var Lx=sx(llon*Math.PI/180), Ly=sy(mercY(llat));
        var cmd=(pi===0||(prevLon!==null&&Math.abs(llon-prevLon)>180))?"M":"L";
        seg+=cmd+Lx.toFixed(1)+" "+Ly.toFixed(1);
        if(Lx>-40&&Lx<W+40&&Ly>-40&&Ly<H+40) any=true;
        prevLon=llon;
      }
      if(any) lp+=seg+"Z";
    }
    if(lp) s+='<path class="pc-land" d="'+lp+'"/>';

    // Graticule fitted to the visible region (a refined faint grid = "a map").
    var lonMin=minX*180/Math.PI, lonMax=maxX*180/Math.PI;
    var latMin=invMercY(minY), latMax=invMercY(maxY);
    var g="";
    var lonStep=niceStep(lonMax-lonMin,6), la0=Math.ceil(lonMin/lonStep)*lonStep;
    for(var lo=la0; lo<=lonMax+1e-6; lo+=lonStep){var gx=sx(lo*Math.PI/180); g+='<line x1="'+gx.toFixed(1)+'" y1="0" x2="'+gx.toFixed(1)+'" y2="'+H+'"/>';}
    var latStep=niceStep(latMax-latMin,4), lt0=Math.ceil(latMin/latStep)*latStep;
    for(var lt=lt0; lt<=latMax+1e-6; lt+=latStep){var gy=sy(mercY(lt)); g+='<line x1="0" y1="'+gy.toFixed(1)+'" x2="'+W+'" y2="'+gy.toFixed(1)+'"/>';}
    s+='<g class="pc-grat">'+g+'</g>';

    // Route legs — a smooth curved arc per hop, mode-coloured (flight/ferry dashed).
    var legs="";
    for(i=1;i<steps.length;i++){
      if(Math.abs(steps[i].lon-steps[i-1].lon)>180) continue;
      var a=pt(i-1), b=pt(i);
      var mx=(a.x+b.x)/2, my=(a.y+b.y)/2, dx=b.x-a.x, dy=b.y-a.y;
      var len=Math.sqrt(dx*dx+dy*dy)||1, off=Math.min(48,len*0.16);
      var qx=(mx+(-dy/len)*off).toFixed(1), qy=(my+(dx/len)*off).toFixed(1);
      var d='M'+a.x.toFixed(1)+' '+a.y.toFixed(1)+' Q'+qx+' '+qy+' '+b.x.toFixed(1)+' '+b.y.toFixed(1);
      var mode=steps[i].arriveBy, col=MODE_COLOR[mode]||MODE_COLOR.other;
      var dash=mode==="flight"?"7 6":(mode==="ferry"?"1.5 7":"");
      legs+='<path class="pc-leg-halo" d="'+d+'"/>';
      legs+='<path class="pc-leg" d="'+d+'" stroke="'+col+'"'+(dash?' stroke-dasharray="'+dash+'"':'')+'/>';
    }
    s+='<g>'+legs+'</g>';

    // Compass rose (top-right). Seed its box so labels never collide with it.
    var ccx=W-42, ccy=50, rr=17;
    s+='<g transform="translate('+ccx+' '+ccy+')">';
    s+='<circle class="pc-compass-face" r="'+rr+'"/>';
    s+='<polygon class="pc-compass-n" points="0,-'+rr+' 4,1 0,4 -4,1"/>';
    s+='<polygon class="pc-compass-s" points="0,'+rr+' 4,-1 0,-4 -4,-1"/>';
    s+='<text class="pc-compass-label" x="0" y="-'+(rr+4)+'" text-anchor="middle">N</text>';
    s+='</g>';

    // City pins: a dot per stop, endpoints emphasised, plus a placed label.
    var dots="", labels="", placed=[{bx:ccx-rr-4,by:ccy-rr-12,ex:ccx+rr+4,ey:ccy+rr+4}];
    for(i=0;i<steps.length;i++){
      var p=pt(i), isStart=i===0, isEnd=i===steps.length-1;
      if(isStart||isEnd){
        dots+='<circle class="pc-pt-ring" cx="'+p.x.toFixed(1)+'" cy="'+p.y.toFixed(1)+'" r="7.5"/>';
        dots+='<circle cx="'+p.x.toFixed(1)+'" cy="'+p.y.toFixed(1)+'" r="4.6" fill="'+(isEnd?END_COLOR:START_COLOR)+'" stroke="var(--pc-map-paper)" stroke-width="1.6"/>';
      }else{
        dots+='<circle class="pc-pt" cx="'+p.x.toFixed(1)+'" cy="'+p.y.toFixed(1)+'" r="3.6"/>';
      }
      var box=placeLabel(p.x,p.y,steps[i].place.name,placed,W,H);
      labels+='<text class="pc-map-label" x="'+box.tx.toFixed(1)+'" y="'+box.ty.toFixed(1)+'" text-anchor="'+box.anchor+'">'+esc(steps[i].place.name)+'</text>';
    }
    s+='<g>'+dots+'</g><g>'+labels+'</g></svg>';
    return s;
  }

  var state={spreads:[],idx:0,journey:null};

  function coverPhoto(j){
    for(var i=0;i<(j.steps||[]).length;i++){var ph=j.steps[i].photos; if(ph&&ph.length) return ph[0];}
    return null;
  }

  function buildCover(j){
    var sec=el("section",{className:"pc-spread pc-cover","aria-label":"Cover",tabIndex:-1});
    var hero=coverPhoto(j);
    var fig=el("div",{className:"pc-cover-hero"+(hero?"":" is-empty")});
    if(hero){ fig.appendChild(el("img",{src:hero.src,alt:hero.caption||("Cover photo — "+(j.title||"a journey")),decoding:"async"})); }
    else { fig.appendChild(el("span",{className:"pc-cover-hero-glyph","aria-hidden":"true",textContent:"🧭"})); }
    sec.appendChild(fig);
    sec.appendChild(el("p",{className:"pc-kicker",textContent:"A Postcards journey"}));
    sec.appendChild(el("h1",{className:"pc-cover-title",textContent:j.title||"A journey"}));
    if(j.subtitle) sec.appendChild(el("p",{className:"pc-cover-sub",textContent:j.subtitle}));
    var dr=j.dateRange||{};
    if(dr.start){
      var range=dr.end&&dr.end!==dr.start?fmtDate(dr.start)+" — "+fmtDate(dr.end):fmtDate(dr.start);
      sec.appendChild(el("p",{className:"pc-cover-dates",textContent:range}));
    }
    var t=j.totals||{countries:0,places:0,distanceKm:0};
    var totals=el("div",{className:"pc-totals",role:"list"});
    function total(n,l){return el("div",{className:"pc-total",role:"listitem"},[
      el("div",{className:"pc-total-n",textContent:n}), el("div",{className:"pc-total-l",textContent:l})]);}
    totals.appendChild(total(fmtInt(t.places), t.places===1?"stop":"stops"));
    totals.appendChild(total(fmtInt(t.countries), t.countries===1?"country":"countries"));
    totals.appendChild(total(fmtInt(t.distanceKm)+" km","travelled"));
    sec.appendChild(totals);
    sec.appendChild(el("p",{className:"pc-cover-hint",textContent:"Turn the page — arrow keys, swipe, or the buttons below →"}));
    sec.appendChild(el("p",{className:"pc-colophon",textContent:"A private travel journal, published with Postcards."}));
    return sec;
  }

  // Shared map content (kicker, heading, the fitted labeled route map, legend,
  // attribution) — used by both the book spread and the blog map card.
  function fillMap(sec,j){
    sec.appendChild(el("p",{className:"pc-kicker",textContent:"The route"}));
    sec.appendChild(el("h2",{textContent:"Where the journey went"}));
    sec.appendChild(el("div",{className:"pc-map",html:mapSvg(j.steps)}));
    var used={};
    for(var i=0;i<j.steps.length;i++){var m=j.steps[i].arriveBy; if(m) used[m]=true;}
    var legend=el("div",{className:"pc-legend","aria-label":"Map legend"});
    function dotItem(color,label){var sp=el("span",{},[el("i",{className:"pc-dot"}),label]); sp.firstChild.style.background=color; return sp;}
    function lineItem(color,label){var sp=el("span",{},[el("i",{className:"pc-swatch"}),label]); sp.firstChild.style.background=color; return sp;}
    if(j.steps.length>1){
      legend.appendChild(dotItem(START_COLOR,"Start"));
      legend.appendChild(dotItem(END_COLOR,"End"));
    }
    var order=["flight","train","bus","ferry","car","other"];
    for(var k=0;k<order.length;k++){ if(!used[order[k]]) continue;
      legend.appendChild(lineItem(MODE_COLOR[order[k]],MODE_LABEL[order[k]]));
    }
    if(legend.childNodes.length) sec.appendChild(legend);
    sec.appendChild(el("p",{className:"pc-attrib",textContent:document.body.getAttribute("data-attrib")||""}));
    return sec;
  }
  function buildMap(j){ // book: a paged spread
    return fillMap(el("section",{className:"pc-spread pc-mapwrap","aria-label":"Journey map",tabIndex:-1}),j);
  }
  function buildMapCard(j){ // blog: a static card near the top
    return fillMap(el("section",{className:"pc-mapwrap pc-mapcard","aria-label":"Journey map"}),j);
  }

  // The feed reads OLDEST→NEWEST so the trip unfolds top to bottom. Flip this one
  // constant to show the newest post first (per-post anchors stay stable either way).
  var FEED_NEWEST_FIRST=false;

  // Index of the most recent (newest-dated) step — the "latest" entry a returning
  // reader wants. Falls back to the last step when nothing is dated.
  function newestIndex(steps){
    var bi=-1, bd=null;
    for(var i=0;i<steps.length;i++){
      var d=steps[i].date;
      if(d!=null&&(bd==null||d>=bd)){ bd=d; bi=i; }
    }
    return bi<0?steps.length-1:bi;
  }
  function entryTitle(step){
    if(step.story&&step.story.title) return step.story.title;
    return step.place.name;
  }
  function themeToggle(){
    var theme=el("button",{className:"pc-theme",type:"button","aria-label":"Toggle light or dark theme",title:"Toggle theme",textContent:"◐"});
    theme.addEventListener("click",function(){
      var r=document.documentElement;
      var dark=r.getAttribute("data-theme")==="dark"||(r.getAttribute("data-theme")!=="light"&&window.matchMedia&&window.matchMedia("(prefers-color-scheme:dark)").matches);
      r.setAttribute("data-theme",dark?"light":"dark");
    });
    return theme;
  }

  function buildStep(step,n,total){
    var sec=el("section",{className:"pc-spread pc-step","aria-label":"Stop "+n+" of "+total+": "+step.place.name,tabIndex:-1});
    sec.appendChild(el("p",{className:"pc-kicker",textContent:"Stop "+n+" of "+total}));
    var hero=el("div",{className:"pc-hero"});
    if(step.arriveBy){
      hero.appendChild(el("span",{className:"pc-badge"},[MODE_GLYPH[step.arriveBy]||"•"," ",MODE_LABEL[step.arriveBy]||"Travel"]));
    }
    if(step.photos&&step.photos.length){
      hero.appendChild(el("img",{src:step.photos[0].src,alt:step.photos[0].caption||("Photo of "+step.place.name),loading:"lazy",decoding:"async"}));
    }else{
      hero.appendChild(el("div",{className:"pc-hero-empty"},[
        el("span",{className:"pc-flag","aria-hidden":"true",textContent:flag(step.place.countryId)}),
        el("span",{className:"pc-place",textContent:step.place.name})]));
    }
    sec.appendChild(hero);
    var meta=el("div",{className:"pc-step-meta"});
    meta.appendChild(el("h2",{},[flag(step.place.countryId)+" "+step.place.name]));
    if(step.date) meta.appendChild(el("span",{className:"pc-step-date",textContent:fmtDate(step.date)}));
    sec.appendChild(meta);
    if(step.story){
      if(step.story.title) sec.appendChild(el("h3",{className:"pc-story-title",textContent:step.story.title}));
      if(step.story.text) sec.appendChild(el("p",{className:"pc-story-text",textContent:step.story.text}));
    }
    if(step.photos&&step.photos.length){
      var gal=el("div",{className:"pc-gallery"});
      for(var i=0;i<step.photos.length;i++){ (function(idx){
        var btn=el("button",{type:"button",className:"pc-thumb","aria-label":"View photo "+(idx+1)+" of "+step.photos.length});
        btn.appendChild(el("img",{src:step.photos[idx].src,alt:step.photos[idx].caption||"",loading:"lazy",decoding:"async"}));
        btn.addEventListener("click",function(){openLightbox(step.photos,idx,btn);});
        gal.appendChild(btn);
      })(i); }
      sec.appendChild(gal);
    }
    return sec;
  }

  // --- lightbox (accessible: arrows page, Escape closes, focus returns) ---
  var lb=null;
  function openLightbox(photos,start,trigger){
    closeLightbox();
    var idx=start;
    var box=el("div",{className:"pc-lightbox",role:"dialog","aria-modal":"true","aria-label":"Photo viewer"});
    var count=el("span",{className:"pc-lb-count","aria-hidden":"true"});
    var img=el("img",{className:"pc-lb-img"});
    var cap=el("p",{className:"pc-lb-cap",role:"status"});
    var close=el("button",{className:"pc-lb-close",type:"button",textContent:"Close",title:"Close (Esc)"});
    var prev=el("button",{className:"pc-lb-nav pc-lb-prev",type:"button","aria-label":"Previous photo",textContent:"‹"});
    var next=el("button",{className:"pc-lb-nav pc-lb-next",type:"button","aria-label":"Next photo",textContent:"›"});
    function show(){
      var p=photos[idx];
      img.src=p.src; img.alt=p.caption||"Photo "+(idx+1);
      cap.textContent=p.caption||"";
      count.textContent=(idx+1)+" / "+photos.length;
      prev.style.display=next.style.display=photos.length>1?"":"none";
    }
    function step(d){idx=(idx+d+photos.length)%photos.length; show();}
    prev.addEventListener("click",function(){step(-1);});
    next.addEventListener("click",function(){step(1);});
    close.addEventListener("click",closeLightbox);
    box.addEventListener("click",function(e){if(e.target===box) closeLightbox();});
    box.appendChild(count); box.appendChild(prev); box.appendChild(img); box.appendChild(next); box.appendChild(close); box.appendChild(cap);
    document.body.appendChild(box);
    lb={box:box,trigger:trigger,step:step};
    show(); close.focus();
  }
  function closeLightbox(){
    if(!lb) return;
    var t=lb.trigger; lb.box.remove(); lb=null;
    if(t&&t.focus) t.focus();
  }

  // --- paging ---
  var bar,counter,prevBtn,nextBtn;
  function go(n){
    n=Math.max(0,Math.min(state.spreads.length-1,n));
    for(var i=0;i<state.spreads.length;i++) state.spreads[i].hidden=(i!==n);
    state.idx=n;
    var pct=state.spreads.length>1?(n/(state.spreads.length-1))*100:100;
    bar.style.width=pct+"%";
    bar.parentNode.setAttribute("aria-valuenow",String(n+1));
    counter.textContent=(n+1)+" / "+state.spreads.length;
    prevBtn.disabled=n===0; nextBtn.disabled=n===state.spreads.length-1;
    var cur=state.spreads[n]; if(cur&&cur.focus) cur.focus();
    window.scrollTo(0,0);
  }

  // Dispatch to the reader the author chose (blog by default). The layout rides
  // on <body data-layout> so it is known even before an encrypted payload unlocks.
  function start(journey){
    state.journey=journey;
    var doc=journey&&journey.title?journey.title:"A journey";
    try{document.title=doc;}catch(_e){}
    var layout=(document.body&&document.body.getAttribute("data-layout"))||"blog";
    if(layout==="book") startBook(journey); else startBlog(journey);
  }

  // --- blog: one long, scrollable page of dated posts (a living travelogue) ---
  function buildPost(step,i,total){
    var art=el("article",{className:"pc-post",id:"entry-"+(i+1),"aria-label":"Entry "+(i+1)+" of "+total+": "+step.place.name});
    var meta=el("div",{className:"pc-post-meta"});
    if(step.date) meta.appendChild(el("time",{className:"pc-post-date",datetime:step.date,textContent:fmtDate(step.date)}));
    if(step.arriveBy) meta.appendChild(el("span",{className:"pc-post-mode"},[MODE_GLYPH[step.arriveBy]||"•"," ",MODE_LABEL[step.arriveBy]||"Travel"]));
    // A stable permalink: a real hash link (works with no JS) that also copies the
    // full URL to the clipboard when available.
    var hash="entry-"+(i+1);
    var link=el("a",{className:"pc-permalink",href:"#"+hash,"aria-label":"Permalink to this entry",title:"Copy link to this entry"});
    link.appendChild(el("span",{className:"pc-permalink-ico","aria-hidden":"true",textContent:"🔗"}));
    link.appendChild(el("span",{className:"pc-permalink-note","aria-hidden":"true",textContent:"Copied"}));
    link.addEventListener("click",function(){
      try{
        var url=(location.href||"").split("#")[0]+"#"+hash;
        if(navigator.clipboard&&navigator.clipboard.writeText) navigator.clipboard.writeText(url);
        link.className="pc-permalink is-copied";
        setTimeout(function(){link.className="pc-permalink";},1400);
      }catch(_e){}
    });
    meta.appendChild(link);
    art.appendChild(meta);

    art.appendChild(el("h2",{className:"pc-post-place"},[flag(step.place.countryId)+" "+step.place.name]));
    if(step.story&&step.story.title) art.appendChild(el("h3",{className:"pc-post-title",textContent:step.story.title}));

    if(step.photos&&step.photos.length){
      var hero=el("button",{type:"button",className:"pc-hero pc-post-hero","aria-label":"View photo 1 of "+step.photos.length});
      hero.appendChild(el("img",{src:step.photos[0].src,alt:step.photos[0].caption||("Photo of "+step.place.name),loading:"lazy",decoding:"async"}));
      hero.addEventListener("click",function(){openLightbox(step.photos,0,hero);});
      art.appendChild(hero);
      if(step.photos.length>1){
        var gal=el("div",{className:"pc-gallery"});
        for(var p=1;p<step.photos.length;p++){ (function(idx){
          var btn=el("button",{type:"button",className:"pc-thumb","aria-label":"View photo "+(idx+1)+" of "+step.photos.length});
          btn.appendChild(el("img",{src:step.photos[idx].src,alt:step.photos[idx].caption||"",loading:"lazy",decoding:"async"}));
          btn.addEventListener("click",function(){openLightbox(step.photos,idx,btn);});
          gal.appendChild(btn);
        })(p); }
        art.appendChild(gal);
      }
    }
    if(step.story&&step.story.text) art.appendChild(el("p",{className:"pc-story-text",textContent:step.story.text}));
    return art;
  }

  function startBlog(journey){
    var app=document.getElementById("pc-app"); app.innerHTML="";
    var steps=journey.steps||[];

    var head=el("div",{className:"pc-head pc-head-blog"});
    head.appendChild(el("span",{className:"pc-blog-brand",textContent:journey.title||"A journey"}));
    head.appendChild(themeToggle());
    app.appendChild(head);

    var blog=el("div",{className:"pc-blog"});
    var mast=el("header",{className:"pc-masthead"});
    mast.appendChild(el("p",{className:"pc-kicker",textContent:"A Postcards travelogue"}));
    mast.appendChild(el("h1",{className:"pc-blog-title",textContent:journey.title||"A journey"}));
    if(journey.subtitle) mast.appendChild(el("p",{className:"pc-blog-sub",textContent:journey.subtitle}));
    var dr=journey.dateRange||{};
    if(dr.start){
      var range=dr.end&&dr.end!==dr.start?fmtDate(dr.start)+" — "+fmtDate(dr.end):fmtDate(dr.start);
      mast.appendChild(el("p",{className:"pc-blog-dates",textContent:range}));
    }
    var nIdx=steps.length?newestIndex(steps):-1;
    var lastDate=nIdx>=0?steps[nIdx].date:(dr.end||null);
    if(lastDate){
      mast.appendChild(el("p",{className:"pc-updated"},[
        el("span",{className:"pc-updated-dot","aria-hidden":"true"}),
        "Last updated "+fmtDate(lastDate)]));
    }
    if(nIdx>=0){
      var latest=el("a",{className:"pc-latest",href:"#entry-"+(nIdx+1)});
      latest.appendChild(el("span",{className:"pc-latest-tag",textContent:"Latest"}));
      latest.appendChild(el("span",{className:"pc-latest-title",textContent:entryTitle(steps[nIdx])}));
      latest.appendChild(el("span",{className:"pc-latest-arrow","aria-hidden":"true",textContent:"→"}));
      mast.appendChild(latest);
    }
    blog.appendChild(mast);

    if(steps.length) blog.appendChild(buildMapCard(journey));

    var feed=el("section",{className:"pc-feed","aria-label":"Journal entries"});
    var order=[];
    for(var i=0;i<steps.length;i++) order.push(i);
    if(FEED_NEWEST_FIRST) order.reverse();
    for(var o=0;o<order.length;o++){
      feed.appendChild(buildPost(steps[order[o]],order[o],steps.length));
      if(o<order.length-1) feed.appendChild(el("hr",{className:"pc-divider","aria-hidden":"true"}));
    }
    blog.appendChild(feed);
    app.appendChild(blog);
  }

  function startBook(journey){
    var app=document.getElementById("pc-app"); app.innerHTML="";

    var head=el("div",{className:"pc-head"});
    var prog=el("div",{className:"pc-progress",role:"progressbar","aria-label":"Reading progress","aria-valuemin":"1"});
    bar=el("div",{className:"pc-progress-bar"}); prog.appendChild(bar);
    counter=el("span",{className:"pc-counter"});
    var theme=themeToggle();
    head.appendChild(prog); head.appendChild(counter); head.appendChild(theme);
    app.appendChild(head);

    var stage=el("div",{className:"pc-stage"}); app.appendChild(stage);
    var spreads=[buildCover(journey)];
    if(journey.steps&&journey.steps.length) spreads.push(buildMap(journey));
    for(var i=0;i<(journey.steps||[]).length;i++) spreads.push(buildStep(journey.steps[i],i+1,journey.steps.length));
    // Page folios — a small editorial "03 / 12" at the foot of every spread.
    for(var f=0;f<spreads.length;f++) spreads[f].appendChild(el("p",{className:"pc-folio","aria-hidden":"true",textContent:pad2(f+1)+" / "+pad2(spreads.length)}));
    state.spreads=spreads;
    for(var kk=0;kk<spreads.length;kk++) stage.appendChild(spreads[kk]);
    prog.setAttribute("aria-valuemax",String(spreads.length));

    var nav=el("nav",{className:"pc-nav","aria-label":"Pages"});
    prevBtn=el("button",{className:"pc-btn",type:"button"},["← Back"]);
    nextBtn=el("button",{className:"pc-btn pc-btn-primary",type:"button"},["Next →"]);
    prevBtn.addEventListener("click",function(){go(state.idx-1);});
    nextBtn.addEventListener("click",function(){go(state.idx+1);});
    nav.appendChild(prevBtn); nav.appendChild(nextBtn);
    app.appendChild(nav);

    // Touch swipe
    var sx=0,sy=0;
    stage.addEventListener("touchstart",function(e){var t=e.changedTouches[0]; sx=t.clientX; sy=t.clientY;},{passive:true});
    stage.addEventListener("touchend",function(e){
      var t=e.changedTouches[0], dx=t.clientX-sx, dy=t.clientY-sy;
      if(Math.abs(dx)>48&&Math.abs(dx)>Math.abs(dy)){ go(state.idx+(dx<0?1:-1)); }
    },{passive:true});

    go(0);
  }

  document.addEventListener("keydown",function(e){
    if(lb){
      if(e.key==="Escape"){closeLightbox(); e.preventDefault();}
      else if(e.key==="ArrowLeft"){lb.step(-1); e.preventDefault();}
      else if(e.key==="ArrowRight"){lb.step(1); e.preventDefault();}
      return;
    }
    var tag=e.target&&e.target.tagName;
    if(tag==="INPUT"||tag==="TEXTAREA") return;
    if(!state.spreads.length) return;
    if(e.key==="ArrowRight"||e.key==="PageDown"){go(state.idx+1); e.preventDefault();}
    else if(e.key==="ArrowLeft"||e.key==="PageUp"){go(state.idx-1); e.preventDefault();}
    else if(e.key==="Home"){go(0); e.preventDefault();}
    else if(e.key==="End"){go(state.spreads.length-1); e.preventDefault();}
  });

  function showGate(env){
    var app=document.getElementById("pc-app"); app.innerHTML="";
    var form=el("form",{className:"pc-gate"});
    form.appendChild(el("h1",{className:"pc-gate-title",textContent:"This journal is locked 🔒"}));
    form.appendChild(el("p",{className:"pc-gate-note",textContent:"Enter the passphrase the author shared with you. It is checked here in your browser — nothing is ever sent to a server."}));
    var input=el("input",{type:"password",className:"pc-gate-input",autocomplete:"off","aria-label":"Passphrase"});
    var label=el("label",{className:"pc-gate-label",textContent:"Passphrase"},[input]);
    var btn=el("button",{className:"pc-btn pc-btn-primary",type:"submit",textContent:"Unlock"});
    var msg=el("p",{className:"pc-gate-msg",role:"alert"});
    form.appendChild(label); form.appendChild(btn); form.appendChild(msg);
    form.addEventListener("submit",function(e){
      e.preventDefault(); msg.textContent=""; btn.disabled=true; btn.textContent="Unlocking…";
      // Normalise identically to the author side (encrypt.ts / PublishScreen):
      // NFC + trim, so a copy-pasted passphrase with stray spaces still unlocks.
      decrypt(env,input.value.normalize("NFC").trim()).then(function(journey){start(journey);}).catch(function(){
        btn.disabled=false; btn.textContent="Unlock"; msg.textContent="Wrong passphrase, or the file is damaged.";
        input.focus(); input.select();
      });
    });
    app.appendChild(form); input.focus();
  }

  function boot(){
    var dataEl=document.getElementById("pc-data");
    var envEl=document.getElementById("pc-env");
    try{
      if(dataEl){ start(JSON.parse(dataEl.textContent)); }
      else if(envEl){ showGate(JSON.parse(envEl.textContent)); }
    }catch(err){
      var app=document.getElementById("pc-app");
      if(app) app.innerHTML="<p class='pc-loading'>This journal could not be opened.</p>";
    }
  }
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",boot); else boot();
})();
`;

/**
 * Render a self-contained reader document for `journey`. When `opts.encrypted`
 * is given, pass `journey: null` and only the AES-GCM envelope ships — the
 * reader gates on a passphrase and decrypts in the visitor's browser.
 */
export function renderReaderHtml(
  journey: PublishedJourney | null,
  opts: RenderReaderOptions = {},
): string {
  const encrypted = opts.encrypted;
  const attribution = opts.attribution ?? DEFAULT_ATTRIBUTION;
  const layout = opts.layout === "book" ? "book" : "blog";
  // Never leak the real title into an encrypted file.
  const docTitle = encrypted ? "A locked journey" : journey?.title || "A journey";
  const payloadScript = encrypted
    ? `<script type="application/json" id="pc-env">${jsonForScript(encrypted)}</script>`
    : `<script type="application/json" id="pc-data">${jsonForScript(journey ?? { title: docTitle, dateRange: {}, steps: [], totals: { countries: 0, places: 0, distanceKm: 0 } })}</script>`;
  // The route-map land silhouette. Static public-domain geometry — it reveals
  // nothing about the journey, so it ships even for encrypted files (the map is
  // drawn client-side after unlock).
  const landScript = `<script type="application/json" id="pc-land">${jsonForScript(LAND_OUTLINE)}</script>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(docTitle)}</title>
<style>${READER_CSS}</style>
</head>
<body data-attrib="${escapeHtml(attribution)}" data-layout="${layout}">
<div class="pc-shell">
<noscript><div class="pc-noscript">This published travel journal needs JavaScript to display. Please enable JavaScript in your browser to read it. Your data stays private — nothing is sent anywhere.</div></noscript>
<main id="pc-app" class="pc-app" aria-live="polite"><p class="pc-loading">Loading the journey…</p></main>
<footer class="pc-foot">Published with Postcards · a private, offline travel journal. ${escapeHtml(attribution)}</footer>
</div>
${payloadScript}
${landScript}
<script>${READER_JS}</script>
</body>
</html>`;
}
