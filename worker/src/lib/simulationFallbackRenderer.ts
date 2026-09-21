import { SIMULATION_HTML_VIEWPORT_HEIGHT, SIMULATION_HTML_VIEWPORT_WIDTH } from "@alt-assessment/shared";

export interface SimulationFallbackRenderResult {
  html: string;
  renderer: "closedGasContainer" | "generic";
}

interface SimulationFallbackInput {
  title?: string | null;
  description: string;
  reasonCodes?: string[];
}

interface GasTemplateFacts {
  title: string;
  hotText: string;
  coolText: string;
  volumeText: string;
  pressureLabel: string;
  tankLabel: string;
  hasCool: boolean;
}

const ENTITY_STOPWORDS = new Set([
  "about",
  "after",
  "also",
  "and",
  "because",
  "before",
  "case",
  "describe",
  "does",
  "from",
  "gets",
  "goes",
  "happen",
  "higher",
  "inside",
  "into",
  "like",
  "lower",
  "more",
  "pressure",
  "real",
  "show",
  "simulation",
  "temperature",
  "that",
  "the",
  "then",
  "this",
  "when",
  "with"
]);

export function buildSimulationFallbackHtml(input: SimulationFallbackInput): SimulationFallbackRenderResult {
  const description = normalizeWhitespace(input.description);
  const gasFacts = resolveGasTemplateFacts(description);
  if (gasFacts) {
    return {
      renderer: "closedGasContainer",
      html: renderClosedGasContainerHtml(gasFacts, description)
    };
  }

  return {
    renderer: "generic",
    html: renderGenericFallbackHtml(input.title, description, input.reasonCodes ?? [])
  };
}

function resolveGasTemplateFacts(description: string): GasTemplateFacts | null {
  const normalized = description.toLowerCase();
  const mentionsContainer = /\b(scuba|oxygen|tank|cylinder|container|bottle|sealed)\b/.test(normalized);
  const mentionsGasPressure = /\b(gas|air|oxygen|particle|particles)\b/.test(normalized) && /\bpressure|gauge|psi\b/.test(normalized);
  const mentionsTemperature = /\btemperature|hot|hotter|heat|heated|cool|cooler|cold|sun\b/.test(normalized);
  const hasHot = /\b(hot|hotter|heat|heated|sun|warmer|increase|increases|rises|higher)\b/.test(normalized);
  const hasCool = /\b(cool|cooler|cold|decrease|decreases|drops|lower|slower)\b/.test(normalized);
  const mentionsConstantVolume = /\bconstant volume|volume stays|volume remains|fixed volume\b/.test(normalized);
  const mentionsGayLussac = /\bgay[- ]?lussac\b/.test(normalized);
  const mentionsScuba = /\bscuba\b/.test(normalized);
  const mentionsOxygen = /\boxygen\b/.test(normalized);
  const mentionsGauge = /\b(?:gauge|psi)\b/.test(normalized);
  const mentionsParticles = /\bparticles?\b/.test(normalized);
  const mentionsHotParticleMotion = /\bparticles?\b.{0,40}\b(?:move|moves|moving)\b.{0,40}\bfaster\b|\bfaster\b.{0,40}\bparticles?\b/.test(normalized);
  const mentionsCoolParticleMotion = /\bparticles?\b.{0,40}\b(?:move|moves|moving)\b.{0,40}\bslower\b|\bslower\b.{0,40}\bparticles?\b/.test(normalized);
  const mentionsTemperaturePressureClaim = /\btemperature\b.{0,80}\bpressure\b|\bpressure\b.{0,80}\btemperature\b/.test(normalized);
  if (
    !mentionsContainer
    || !mentionsGasPressure
    || !mentionsTemperature
    || !mentionsGauge
    || !mentionsParticles
    || !mentionsConstantVolume
    || !mentionsTemperaturePressureClaim
    || !hasHot
    || !hasCool
    || !mentionsHotParticleMotion
    || !mentionsCoolParticleMotion
  ) {
    return null;
  }

  const titleParts: string[] = [];
  if (mentionsGayLussac) titleParts.push("Gay-Lussac's Law");
  if (mentionsScuba || mentionsOxygen || /\btank\b/.test(normalized)) {
    titleParts.push([
      mentionsScuba ? "Scuba" : "",
      mentionsOxygen ? "Oxygen" : "",
      "Tank"
    ].filter(Boolean).join(" "));
  }

  return {
    title: titleParts.length > 0 ? formatGasTitle(titleParts) : "Gas Pressure in a Closed Container",
    hotText: hasHot ? "Temperature increases, pressure increases." : "Hotter state.",
    coolText: hasCool ? "Temperature decreases, pressure decreases." : "Cooler state was not described.",
    volumeText: mentionsConstantVolume ? "Container volume stays constant." : "The gas stays inside the container.",
    pressureLabel: "Pressure gauge",
    tankLabel: mentionsOxygen ? "Oxygen tank" : "Gas tank",
    hasCool
  };
}

function formatGasTitle(titleParts: string[]): string {
  if (titleParts.length === 2) return `${titleParts[0]} (${titleParts[1]})`;
  return titleParts.join(" - ");
}

function renderClosedGasContainerHtml(facts: GasTemplateFacts, _description: string): string {
  const title = escapeHtml(facts.title);
  const hotText = escapeHtml(facts.hotText);
  const coolText = escapeHtml(facts.coolText);
  const volumeText = escapeHtml(facts.volumeText);
  const pressureLabel = escapeHtml(facts.pressureLabel);
  const tankLabel = escapeHtml(facts.tankLabel);
  const subtitle = escapeHtml("Pressure changes with temperature while volume stays almost constant.");
  const hasCool = facts.hasCool;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=${SIMULATION_HTML_VIEWPORT_WIDTH}, height=${SIMULATION_HTML_VIEWPORT_HEIGHT}">
<title>${title}</title>
<style>
:root{font-family:Arial,Helvetica,sans-serif;color:#101820;background:#f7f8fa}
*{box-sizing:border-box}
html,body{width:100%;height:100%;margin:0;overflow:hidden}
body{display:grid;grid-template-rows:40px 58px 382px 160px;width:${SIMULATION_HTML_VIEWPORT_WIDTH}px;height:${SIMULATION_HTML_VIEWPORT_HEIGHT}px;background:#f7f8fa}
button{font:inherit}
.toolbar{display:flex;align-items:center;gap:7px;padding:7px 14px;border-bottom:1px solid #d7dde6;background:#ffffff}
.toolbar button,.state-button{min-height:26px;padding:4px 11px;border:1px solid #b8c4d3;border-radius:6px;background:#f4f7fb;color:#0c1b2a;font-weight:700;cursor:pointer}
.toolbar span{margin-left:auto;color:#405064;font-size:13px;font-weight:700}
.heading{text-align:center;padding:5px 72px 0;overflow:hidden}
.heading h1{margin:0;font-size:25px;line-height:1.05;letter-spacing:0}
.heading p{margin:2px 0 0;color:#314154;font-size:13px}
.stage{position:relative;padding:0 28px}
.state-button{position:absolute;top:104px;width:148px;height:56px;color:#fff;font-size:23px;border-width:3px;text-transform:uppercase}
.state-button.hot{left:40px;border-color:#ac1111;background:linear-gradient(#ff4a42,#df0600)}
.state-button.cool{right:34px;border-color:#164ca2;background:linear-gradient(#428af0,#0f58c8)}
.state-button:disabled{opacity:.45;cursor:not-allowed}
.state-note{position:absolute;top:174px;width:150px;height:116px;padding:10px 10px;border:2px solid currentColor;border-radius:8px;background:#fff;font-size:16px;line-height:1.1;text-align:center;font-weight:800;overflow:hidden}
.state-note.hot{left:40px;color:#d11111}
.state-note.cool{right:34px;color:#1657bf}
.arrow{position:absolute;top:137px;width:82px;height:0;border-top:5px solid currentColor}
.arrow.hot{left:224px;color:#e31313}
.arrow.cool{right:208px;color:#165cc9}
.arrow::after{content:"";position:absolute;top:-13px;border-top:10px solid transparent;border-bottom:10px solid transparent}
.arrow.hot::after{right:-1px;border-left:26px solid currentColor}
.arrow.cool::after{left:-1px;border-right:26px solid currentColor}
svg{position:absolute;left:330px;top:0;width:358px;height:374px;overflow:visible}
.label{position:absolute;color:#0a0f16;font-size:16px;font-weight:800;line-height:1.1;max-width:140px}
.label small{display:block;font-size:12px;font-weight:500}
.label.pressure{left:646px;top:70px}
.label.particles{left:672px;top:212px}
.label.volume{left:672px;top:298px}
.callout{position:absolute;height:3px;background:#0a0f16;transform-origin:left center}
.callout.pressure{left:578px;top:88px;width:66px;transform:rotate(-19deg)}
.callout.particles{left:604px;top:234px;width:62px;transform:rotate(-5deg)}
.callout.volume{left:604px;top:310px;width:62px;transform:rotate(1deg)}
.footer{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;padding:6px 24px 10px}
.panel{border:2px solid #0f1720;border-radius:8px;background:#fff;overflow:hidden}
.panel h2{margin:0;padding:6px 8px;color:#fff;font-size:15px;line-height:1;text-align:center}
.panel.hot{border-color:#d11111}.panel.hot h2{background:#d11111}.panel.cool{border-color:#155dc5}.panel.cool h2{background:#155dc5}
.panel.legend h2{color:#0f1720;background:#fff}
.panel p,.panel li{font-size:13px;line-height:1.18}.panel p{margin:7px 10px}.panel ul{margin:7px 12px 8px 22px;padding:0}
.legend-row{display:flex;align-items:center;gap:10px;margin:6px 12px;font-size:13px}.swatch{width:22px;height:22px;border-radius:5px}.swatch.hot{border:2px solid #ff4a42;background:#ffdada}.swatch.cool{border:2px solid #5da0ff;background:#dcebff}.dot{width:22px;height:22px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#d8f1ff,#1474e8 65%,#0f4a9c)}
.tank-glow{transition:fill .18s ease}.needle{transition:transform .18s ease;transform-origin:210px 88px}
body.hot-state .tank-glow{fill:#ffe0de}body.cool-state .tank-glow{fill:#dcebff}body.hot-state .needle{transform:rotate(22deg)}body.cool-state .needle{transform:rotate(-24deg)}
.particle{animation:drift 1.2s linear infinite}.p2{animation-duration:.95s}.p3{animation-duration:1.45s}.p4{animation-duration:1.05s}
body.paused .particle{animation-play-state:paused}body.cool-state .particle{animation-duration:2.15s}
@keyframes drift{0%{transform:translate(0,0)}50%{transform:translate(8px,-5px)}100%{transform:translate(0,0)}}
</style>
</head>
<body class="paused hot-state">
<div class="toolbar"><button id="play">Play</button><button id="pause">Pause</button><button id="reset">Reset</button><button id="step">Step Forward</button><span id="status">Paused</span></div>
<header class="heading"><h1>${title}</h1><p>${subtitle}</p></header>
<main class="stage" aria-label="Interactive simulation fallback">
<button class="state-button hot" id="hot">Hotter</button>
${hasCool ? '<button class="state-button cool" id="cool">Cooler</button>' : '<button class="state-button cool" id="cool" disabled>Cooler</button>'}
<div class="arrow hot"></div><div class="arrow cool"></div>
<div class="state-note hot">${hotText}</div><div class="state-note cool">${coolText}</div>
<svg viewBox="0 0 420 470" role="img" aria-label="${tankLabel}">
<defs>
<radialGradient id="steel" cx="42%" cy="20%" r="75%"><stop offset="0%" stop-color="#fff"/><stop offset="58%" stop-color="#cfd5dc"/><stop offset="100%" stop-color="#808a96"/></radialGradient>
<linearGradient id="base" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#2e3339"/><stop offset="1" stop-color="#0d1115"/></linearGradient>
</defs>
<circle cx="210" cy="78" r="74" fill="#f9fbfd" stroke="#222831" stroke-width="8"/>
<circle cx="210" cy="78" r="62" fill="none" stroke="#8b949e" stroke-width="2"/>
<g stroke="#1a2028" stroke-width="2">${renderGaugeTicks()}</g>
<text x="210" y="43" text-anchor="middle" font-size="16" font-weight="800">2000</text><text x="157" y="86" text-anchor="middle" font-size="15" font-weight="800">1000</text><text x="258" y="86" text-anchor="middle" font-size="15" font-weight="800">3000</text><text x="210" y="134" text-anchor="middle" font-size="15" font-weight="800">psi</text>
<line class="needle" x1="210" y1="88" x2="250" y2="45" stroke="#e11d18" stroke-width="5" stroke-linecap="round"/><circle cx="210" cy="88" r="8" fill="#3b4046" stroke="#111"/>
<rect x="188" y="150" width="44" height="32" rx="4" fill="#c49a57" stroke="#2b2114" stroke-width="3"/><rect x="175" y="174" width="70" height="26" rx="7" fill="#d7b56e" stroke="#2b2114" stroke-width="3"/>
<path d="M112 230 Q112 181 162 181 H258 Q308 181 308 230 V412 Q308 432 288 438 H132 Q112 432 112 412 Z" fill="url(#steel)" stroke="#222831" stroke-width="4"/>
<path class="tank-glow" d="M134 238 Q134 205 168 205 H252 Q286 205 286 238 V400 H134 Z" fill="#f2f7ff" opacity=".82"/>
<rect x="108" y="392" width="204" height="66" rx="12" fill="url(#base)" stroke="#101418" stroke-width="4"/>
${renderParticles()}
<text x="210" y="456" text-anchor="middle" fill="#fff" font-size="13" font-weight="800">${tankLabel}</text>
</svg>
<div class="callout pressure"></div><div class="label pressure">${pressureLabel}<small>shown by needle movement</small></div>
<div class="callout particles"></div><div class="label particles">Gas particles<small>movement changes by state</small></div>
<div class="callout volume"></div><div class="label volume">${volumeText}</div>
</main>
<footer class="footer">
<section class="panel hot"><h2>When HOTTER is clicked:</h2><ul><li>Gas particles move faster.</li><li>Tank glows slightly red.</li><li>Gauge needle moves higher.</li><li>${hotText}</li></ul></section>
<section class="panel legend"><h2>Legend</h2><div class="legend-row"><span class="swatch hot"></span><span>Hotter state</span></div><div class="legend-row"><span class="swatch cool"></span><span>Cooler state</span></div><div class="legend-row"><span class="dot"></span><span>Gas particle</span></div></section>
<section class="panel cool"><h2>When COOLER is clicked:</h2><ul><li>Gas particles move slower.</li><li>Tank glows slightly blue.</li><li>Gauge needle moves lower.</li><li>${coolText}</li></ul></section>
</footer>
<script>
(function(){
var body=document.body,status=document.getElementById("status"),step=0;
function setState(name){body.classList.toggle("hot-state",name==="hot");body.classList.toggle("cool-state",name==="cool");status.textContent=(body.classList.contains("paused")?"Paused - ":"")+name.charAt(0).toUpperCase()+name.slice(1)+" state";}
document.getElementById("play").onclick=function(){body.classList.remove("paused");status.textContent="Playing";};
document.getElementById("pause").onclick=function(){body.classList.add("paused");status.textContent="Paused";};
document.getElementById("reset").onclick=function(){step=0;body.classList.add("paused");setState("hot");status.textContent="Paused";};
document.getElementById("step").onclick=function(){step+=1;setState(step%2===0?"hot":"cool");};
document.getElementById("hot").onclick=function(){setState("hot");};
document.getElementById("cool").onclick=function(){if(!this.disabled)setState("cool");};
})();
</script>
</body>
</html>`;
}

function renderGenericFallbackHtml(title: string | null | undefined, description: string, reasonCodes: string[]): string {
  const safeTitle = escapeHtml(title?.trim() || "Structured Simulation Preview");
  const safeDescription = escapeHtml(truncateForUi(description || "No description was provided.", 180));
  const entities = extractEntityNames(description).slice(0, 6);
  const entityMarkup = entities.map((entity, index) => {
    const x = 150 + (index % 3) * 300;
    const y = 130 + Math.floor(index / 3) * 160;
    const color = ["#2f80ed", "#2d9c73", "#f2994a", "#bb6bd9", "#eb5757", "#56ccf2"][index % 6];
    return `<g class="node n${index + 1}" transform="translate(${x} ${y})"><circle r="46" fill="${color}"/><text y="6" text-anchor="middle">${escapeHtml(entity)}</text></g>`;
  }).join("");
  const issueText = reasonCodes.length > 0 ? escapeHtml(reasonCodes.join(", ")) : "layout health check";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=${SIMULATION_HTML_VIEWPORT_WIDTH}, height=${SIMULATION_HTML_VIEWPORT_HEIGHT}">
<title>${safeTitle}</title>
<style>
*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden}body{display:grid;grid-template-rows:40px 70px 370px 160px;width:${SIMULATION_HTML_VIEWPORT_WIDTH}px;height:${SIMULATION_HTML_VIEWPORT_HEIGHT}px;font-family:Arial,Helvetica,sans-serif;color:#18222e;background:#f8fafc}.toolbar{display:flex;gap:7px;align-items:center;padding:7px 14px;border-bottom:1px solid #d6deea;background:#fff}.toolbar button{min-height:26px;padding:4px 11px;border:1px solid #bac7d6;border-radius:6px;background:#f3f7fb;font-weight:700}.toolbar span{margin-left:auto;font-size:13px;font-weight:700;color:#506174}.heading{text-align:center;padding:8px 54px 0;overflow:hidden}.heading h1{margin:0;font-size:25px;line-height:1.1}.heading p{margin:4px 0 0;font-size:13px;color:#43556b}.stage{padding:10px 52px}.stage svg{width:100%;height:100%;border:2px solid #d7e0ea;border-radius:8px;background:#fff}.node text{fill:#fff;font-size:17px;font-weight:800;pointer-events:none}.node{transition:transform .18s ease}.playing .node{animation:pulse 1.2s ease-in-out infinite}.node:nth-child(2n){animation-delay:.25s}@keyframes pulse{50%{transform:translate(var(--x,0),var(--y,0)) scale(1.05)}}.footer{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:8px 26px 12px}.panel{border:2px solid #d7e0ea;border-radius:8px;background:#fff;padding:10px}.panel h2{margin:0 0 6px;font-size:16px}.panel p{margin:0;font-size:14px;line-height:1.25;color:#304257}
</style>
</head>
<body>
<div class="toolbar"><button id="play">Play</button><button id="pause">Pause</button><button id="reset">Reset</button><button id="step">Step Forward</button><span id="status">Paused</span></div>
<header class="heading"><h1>${safeTitle}</h1><p>${safeDescription}</p></header>
<main class="stage"><svg viewBox="0 0 1000 420" role="img" aria-label="${safeTitle}"><defs><marker id="arrow" markerWidth="9" markerHeight="9" refX="7" refY="4" orient="auto"><path d="M0,0 L0,8 L8,4 z" fill="#526171"/></marker></defs><line x1="190" y1="130" x2="450" y2="130" stroke="#526171" stroke-width="5" marker-end="url(#arrow)"/><line x1="530" y1="130" x2="790" y2="130" stroke="#526171" stroke-width="5" marker-end="url(#arrow)"/>${entityMarkup || '<g class="node" transform="translate(500 210)"><circle r="56" fill="#2f80ed"/><text y="6" text-anchor="middle">event</text></g>'}</svg></main>
<footer class="footer"><section class="panel"><h2>Structured fallback</h2><p>This app-owned renderer replaced a preview that failed: ${issueText}.</p></section><section class="panel"><h2>Source description</h2><p>${safeDescription}</p></section></footer>
<script>(function(){var body=document.body,status=document.getElementById("status"),step=0;document.getElementById("play").onclick=function(){body.classList.add("playing");status.textContent="Playing";};document.getElementById("pause").onclick=function(){body.classList.remove("playing");status.textContent="Paused";};document.getElementById("reset").onclick=function(){step=0;body.classList.remove("playing");status.textContent="Paused";};document.getElementById("step").onclick=function(){step+=1;status.textContent="Step "+step;};})();</script>
</body>
</html>`;
}

function renderGaugeTicks(): string {
  let output = "";
  for (let index = 0; index <= 20; index += 1) {
    const angle = -210 + index * 12;
    const radians = angle * Math.PI / 180;
    const outerX = 210 + Math.cos(radians) * 58;
    const outerY = 78 + Math.sin(radians) * 58;
    const innerRadius = index % 5 === 0 ? 46 : 52;
    const innerX = 210 + Math.cos(radians) * innerRadius;
    const innerY = 78 + Math.sin(radians) * innerRadius;
    output += `<line x1="${innerX.toFixed(1)}" y1="${innerY.toFixed(1)}" x2="${outerX.toFixed(1)}" y2="${outerY.toFixed(1)}"/>`;
  }
  return output;
}

function renderParticles(): string {
  const particles = [
    [160, 260], [224, 244], [266, 282], [178, 318], [238, 330], [204, 286], [262, 360], [154, 370], [218, 388]
  ];
  return particles.map(([x, y], index) => `<g class="particle p${index % 4 + 1}"><path d="M${x - 22} ${y + 8} L${x - 5} ${y}" stroke="#83bfff" stroke-width="2" opacity=".65"/><circle cx="${x}" cy="${y}" r="9" fill="#1976e8" stroke="#0b4fa6" stroke-width="2"/></g>`).join("");
}

function truncateForUi(value: string, maxLength: number): string {
  const normalized = normalizeWhitespace(value);
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

function extractEntityNames(description: string): string[] {
  const tokens = (description.toLowerCase().match(/[a-z0-9]+(?:'[a-z0-9]+)?/g) ?? [])
    .filter((token) => token.length >= 3 && !ENTITY_STOPWORDS.has(token));
  return Array.from(new Set(tokens)).slice(0, 8);
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
