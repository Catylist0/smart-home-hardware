"use strict";
// Smart Home Hardware directory. Loads data/catalog.json (built by scripts/export.py) and renders
// a home view of categories plus a filterable product list. All state lives in the URL hash.

const GROUPS = [
  ["Lighting and shading", [
    ["lighting-control", "Dimmers and lighting control", "Dimmers, relays, DALI and DMX controllers"],
    ["smart-lamps", "Smart bulbs and fixtures", "Connected bulbs, strips and light fittings"],
    ["shading", "Blinds and curtains", "Motors and controls for blinds, shades and curtains"]]],
  ["Climate and sensing", [
    ["hvac-control", "Thermostats and AC control", "Thermostats, AC and VRF gateways, underfloor heating"],
    ["sensors", "Sensors", "Motion, presence, temperature, air quality, leak and contact"]]],
  ["Security and access", [
    ["cameras", "Cameras", "Indoor and outdoor security cameras and recorders"],
    ["locks-access", "Smart locks and access", "Smart locks, readers and access control"],
    ["intercom", "Doorbells and intercoms", "Video doorbells, door stations and indoor monitors"],
    ["alarm", "Alarm systems", "Intrusion alarm panels and accessories"]]],
  ["Controls and interfaces", [
    ["controllers", "Hubs and controllers", "Central processors, hubs and home servers"],
    ["keypads", "Wall switches and keypads", "Smart switches, keypads and scene controllers"],
    ["touchscreens", "Touch panels", "In-wall and tabletop touchscreens"],
    ["remotes", "Remotes", "Handheld remotes and buttons"],
    ["voice", "Voice control", "Voice assistants and voice hardware"]]],
  ["Power and networking", [
    ["power-modules", "Relays and smart plugs", "Smart plugs, in-wall relays and power modules"],
    ["energy", "Energy monitoring", "Energy meters, smart panels, solar and EV integration"],
    ["networking", "Networking and Wi-Fi", "Routers, switches and Wi-Fi access points"]]],
  ["Audio and video", [
    ["multiroom-audio", "Multiroom audio", "Streamers, amplifiers and multiroom systems"],
    ["speakers", "Speakers", "In-wall, in-ceiling and standalone speakers"],
    ["video-distribution", "Video distribution", "HDMI matrices and AV-over-IP"],
    ["cinema-media", "Home cinema", "Media servers, processors, projectors and screens"]]],
  ["Other", [
    ["outdoor", "Gates, garage and garden", "Gate, garage, pool and irrigation automation"],
    ["appliances", "Appliances", "Connected household appliances"],
    ["hotel-grms", "Hotel room control", "Guest-room management for hospitality"]]],
];
const CAT = {}; GROUPS.forEach(([g, cs]) => cs.forEach(([id, name, desc]) => CAT[id] = { id, name, desc, group: g }));
const PROTO = { wifi: "Wi-Fi", ethernet: "Ethernet", poe: "PoE", bluetooth: "Bluetooth", zigbee: "Zigbee", thread: "Thread",
  matter: "Matter", zwave: "Z-Wave", knx: "KNX", rs485: "RS-485", lte: "LTE", "proprietary-rf": "Proprietary RF" };
const AED_PER_USD = 3.6725;
const PAGE = 120;

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const host = u => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
const safeUrl = u => /^https?:\/\//i.test(u || "") ? u : "";
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };

let D, P = [], BYID = {}, VEND = {}, shown = PAGE;
const S = { q: "", cat: new Set(), brand: new Set(), proto: new Set(), pmin: "", pmax: "", priced: false, gulf: false, local: false, ha: false, ann: true, sort: "rel", p: "" };

// ---------- money ----------
let CUR = store.get("cur") || "AED";
function usdTo(v, cur = CUR) { return cur === "AED" ? v * AED_PER_USD : cur === "USD" ? v : v / D.fx_usd[cur]; }
function fromUsd(v, cur = CUR) { return cur === "AED" ? v / AED_PER_USD : cur === "USD" ? v : v * D.fx_usd[cur]; }
function money(v, cur = CUR, exact = false) {
  if (v == null) return "";
  const sym = { USD: "$", EUR: "€", GBP: "£" }[cur];
  const n = exact ? v.toLocaleString("en-US", { maximumFractionDigits: 2 })
    : v >= 100 ? Math.round(v).toLocaleString("en-US") : v.toFixed(v >= 10 ? 0 : 2).replace(/\.00$/, "");
  return sym ? sym + n : `${cur} ${n}`;
}

// ---------- data ----------
async function load() {
  const r = await fetch("data/catalog.json");
  D = await r.json();
  D.vendors.forEach(v => VEND[v.name] = v);
  P = D.products.map(p => {
    const us = p.prices.map(x => x.usd), gulf = p.prices.filter(x => x.gulf);
    p._lo = us.length ? Math.min(...us) : null;
    p._gulf = gulf.length ? gulf.reduce((a, b) => (a.usd <= b.usd ? a : b)) : null;
    p._regions = [...new Set(p.prices.map(x => regionLabel(x.region)))].filter(Boolean);
    p._hay = [p.vendor, p.model, p.family, (p.part_numbers || []).join(" "), p.description, CAT[p.domain]?.name].join(" ").toLowerCase();
    BYID[p.id] = p;
    return p;
  });
  $("gen").textContent = D.generated;
  if (P.some(p => p.protocols || p.local_control || p.home_assistant)) $("sec-proto").hidden = false;
}
function regionLabel(r) {
  r = String(r || "").trim();
  if (/UAE|^AE\b|Dubai|Abu Dhabi/i.test(r)) return "UAE";
  if (/KSA|Saudi|^SA\b|Riyadh/i.test(r)) return "Saudi Arabia";
  return r.split(/[ ,(/]/)[0].toUpperCase();
}

// ---------- filtering ----------
function terms() { return S.q.toLowerCase().split(/\s+/).filter(Boolean); }
function matches(p, skip) {
  const t = terms();
  if (t.length && !t.every(w => p._hay.includes(w))) return false;
  if (skip !== "cat" && S.cat.size && !S.cat.has(p.domain)) return false;
  if (skip !== "brand" && S.brand.size && !S.brand.has(p.vendor)) return false;
  if (S.proto.size && !(p.protocols || []).some(x => S.proto.has(x))) return false;
  if (!S.ann && p.status === "announced") return false;
  if ((S.priced || S.pmin || S.pmax) && p._lo == null) return false;
  if (S.gulf && !p._gulf) return false;
  if (S.local && p.local_control !== "yes") return false;
  if (S.ha && !["native", "community"].includes(p.home_assistant)) return false;
  if (S.pmin && p._lo < fromUsd(+S.pmin)) return false;
  if (S.pmax && p._lo > fromUsd(+S.pmax)) return false;
  return true;
}
function score(p, t) {
  let s = 0; const m = p.model.toLowerCase(), v = p.vendor.toLowerCase();
  for (const w of t) {
    if (m.startsWith(w)) s += 6; else if (m.includes(w)) s += 4;
    if (v.startsWith(w)) s += 3;
    if ((p.part_numbers || []).some(x => x.toLowerCase() === w)) s += 10;
    if ((p.family || "").toLowerCase().includes(w)) s += 2;
  }
  return s + (p._lo != null ? .5 : 0) + (p._gulf ? .3 : 0);
}
const anyFilter = () => S.q || S.cat.size || S.brand.size || S.proto.size || S.pmin || S.pmax || S.priced || S.gulf || S.local || S.ha || !S.ann;

// ---------- URL state ----------
function writeHash() {
  const h = new URLSearchParams();
  if (S.q) h.set("q", S.q);
  if (S.cat.size) h.set("cat", [...S.cat].join(","));
  if (S.brand.size) h.set("brand", [...S.brand].join(","));
  if (S.proto.size) h.set("works", [...S.proto].join(","));
  ["pmin", "pmax"].forEach(k => S[k] && h.set(k, S[k]));
  ["priced", "gulf", "local", "ha"].forEach(k => S[k] && h.set(k, "1"));
  if (!S.ann) h.set("ann", "0");
  if (S.sort !== "rel") h.set("sort", S.sort);
  if (S.p) h.set("p", S.p);
  const s = h.toString().replace(/%2C/g, ",").replace(/\+/g, "%20");
  if (location.hash.slice(1) !== s) history.replaceState(null, "", s ? "#" + s : location.pathname + location.search);
}
function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  S.q = h.get("q") || "";
  const set = k => new Set((h.get(k) || "").split(",").filter(Boolean));
  S.cat = set("cat"); S.brand = set("brand"); S.proto = set("works");
  S.pmin = h.get("pmin") || ""; S.pmax = h.get("pmax") || "";
  ["priced", "gulf", "local", "ha"].forEach(k => S[k] = h.get(k) === "1");
  S.ann = h.get("ann") !== "0"; S.sort = h.get("sort") || "rel"; S.p = h.get("p") || "";
}
function syncInputs() {
  $("q").value = S.q; $("pmin").value = S.pmin; $("pmax").value = S.pmax; $("sort").value = S.sort; $("cur").value = CUR;
  ["priced", "gulf", "local", "ha"].forEach(k => $("f-" + k).checked = S[k]); $("f-ann").checked = S.ann;
  $("price-unit").textContent = `(${CUR})`;
}

// ---------- render ----------
function render() {
  writeHash();
  renderFilters();
  const home = !anyFilter();
  $("home").hidden = !home; $("results").hidden = home;
  if (home) renderHome(); else renderResults();
  renderDrawer();
}
function countBy(skip, key) {
  const c = {}; for (const p of P) if (matches(p, skip)) c[p[key]] = (c[p[key]] || 0) + 1; return c;
}
function renderFilters() {
  const cc = countBy("cat", "domain");
  $("f-cat").innerHTML = GROUPS.map(([g, cs]) => {
    const items = cs.filter(([id]) => P.some(p => p.domain === id));
    if (!items.length) return "";
    return `<div class="fgroup"><b>${esc(g)}</b>${items.map(([id, name]) =>
      `<button class="opt${S.cat.has(id) ? " on" : ""}${cc[id] ? "" : " zero"}" data-cat="${id}">${esc(name)}<span class="n">${cc[id] || 0}</span></button>`).join("")}</div>`;
  }).join("");
  const bc = countBy("brand", "vendor"), bq = $("brand-q").value.trim().toLowerCase();
  $("f-brand").innerHTML = D.vendors.map(v => v.name).sort((a, b) => a.localeCompare(b))
    .filter(n => !bq || n.toLowerCase().includes(bq) || S.brand.has(n))
    .sort((a, b) => (S.brand.has(b) - S.brand.has(a)) || ((bc[b] ? 1 : 0) - (bc[a] ? 1 : 0)))
    .map(n => `<button class="opt${S.brand.has(n) ? " on" : ""}${bc[n] ? "" : " zero"}" data-brand="${esc(n)}">${esc(n)}<span class="n">${bc[n] || 0}</span></button>`).join("");
  const protos = [...new Set(P.flatMap(p => p.protocols || []))];
  $("f-proto").innerHTML = Object.keys(PROTO).filter(k => protos.includes(k))
    .map(k => `<button class="chip${S.proto.has(k) ? " on" : ""}" data-proto="${k}">${PROTO[k]}</button>`).join("");
  const n = S.cat.size + S.brand.size + S.proto.size + (S.pmin ? 1 : 0) + (S.pmax ? 1 : 0) + ["priced", "gulf", "local", "ha"].filter(k => S[k]).length;
  $("fcount").textContent = n ? `(${n})` : "";
}
function renderHome() {
  const priced = P.filter(p => p._lo != null).length, gulf = P.filter(p => p._gulf).length;
  const cc = {}; P.forEach(p => cc[p.domain] = (cc[p.domain] || 0) + 1);
  const brandsIn = id => new Set(P.filter(p => p.domain === id).map(p => p.vendor)).size;
  const lo = id => { const v = P.filter(p => p.domain === id && p._lo != null).map(p => p._lo); return v.length ? Math.min(...v) : null; };
  $("home").innerHTML = `
    <section class="hero">
      <h1>Every current smart home product, in one place.</h1>
      <p>Browse ${P.length.toLocaleString()} products from ${D.vendors.length} manufacturers by category or brand, or search by name or part number. Open any product to see its part numbers, every public price we found and where each price came from.</p>
      <div class="stats">
        <div><b>${P.length.toLocaleString()}</b><span>products</span></div>
        <div><b>${D.vendors.length}</b><span>brands</span></div>
        <div><b>${priced.toLocaleString()}</b><span>with public prices</span></div>
        <div><b>${gulf.toLocaleString()}</b><span>priced in the Gulf</span></div>
      </div>
    </section>
    ${GROUPS.map(([g, cs]) => {
      const items = cs.filter(([id]) => cc[id]);
      return items.length ? `<section class="group"><h2>${esc(g)}</h2><div class="tiles">${items.map(([id, name, desc]) => {
        const l = lo(id);
        return `<button class="tile" data-go-cat="${id}"><b>${esc(name)}</b><span class="d">${esc(desc)}</span>
          <span class="meta">${cc[id]} products · ${brandsIn(id)} brands${l != null ? ` · from ${money(usdTo(l))}` : ""}</span></button>`;
      }).join("")}</div></section>` : "";
    }).join("")}
    <section class="group"><h2>Brands</h2><div class="brands">${D.vendors.map(v => v.name).sort((a, b) => a.localeCompare(b))
      .map(n => `<button data-go-brand="${esc(n)}">${esc(n)}<span>${P.filter(p => p.vendor === n).length}</span></button>`).join("")}</div></section>`;
}
function renderResults() {
  const t = terms();
  let rows = P.filter(p => matches(p));
  const name = (a, b) => a.vendor.localeCompare(b.vendor) || a.model.localeCompare(b.model);
  const inf = v => v ?? Infinity;
  const sorts = {
    rel: t.length ? (a, b) => score(b, t) - score(a, t) || name(a, b)
      : (a, b) => catOrder(a.domain) - catOrder(b.domain) || ((b._lo != null) - (a._lo != null)) || name(a, b),
    pa: (a, b) => inf(a._lo) - inf(b._lo) || name(a, b),
    pd: (a, b) => (b._lo ?? -1) - (a._lo ?? -1) || name(a, b),
    brand: name, name: (a, b) => a.model.localeCompare(b.model),
  };
  rows.sort(sorts[S.sort] || sorts.rel);
  $("count").textContent = `${rows.length.toLocaleString()} product${rows.length === 1 ? "" : "s"}`;
  const crumbs = [];
  if (S.q) crumbs.push(["q", "", `“${S.q}”`]);
  S.cat.forEach(c => crumbs.push(["cat", c, CAT[c]?.name || c]));
  S.brand.forEach(b => crumbs.push(["brand", b, b]));
  S.proto.forEach(x => crumbs.push(["proto", x, PROTO[x]]));
  if (S.pmin || S.pmax) crumbs.push(["price", "", `${S.pmin ? money(+S.pmin) : "Any"} – ${S.pmax ? money(+S.pmax) : "any"}`]);
  [["priced", "Has price"], ["gulf", "Gulf price"], ["local", "Local control"], ["ha", "Home Assistant"]].forEach(([k, l]) => S[k] && crumbs.push([k, "", l]));
  if (!S.ann) crumbs.push(["ann", "", "Current only"]);
  $("crumbs").innerHTML = crumbs.map(([k, v, l]) => `<button class="crumb" data-un="${k}" data-v="${esc(v)}">${esc(l)} <i>✕</i></button>`).join("");
  $("vendor").innerHTML = S.brand.size === 1 ? vendorPanel(VEND[[...S.brand][0]]) : "";
  $("list").innerHTML = rows.length ? rows.slice(0, shown).map(rowHtml).join("")
    : `<li class="empty">No products match these filters. <button class="link" data-clear>Clear filters</button></li>`;
  $("more-wrap").hidden = rows.length <= shown;
  $("more").textContent = `Show more (${(rows.length - shown).toLocaleString()} left)`;
}
const ORDER = GROUPS.flatMap(([, cs]) => cs.map(([id]) => id));
const catOrder = d => { const i = ORDER.indexOf(d); return i < 0 ? 99 : i; };
function rowHtml(p) {
  const tags = [];
  if (!S.cat.size || S.cat.size > 1) tags.push(`<span class="tag">${esc(CAT[p.domain]?.name || p.domain)}</span>`);
  if (p.status === "announced") tags.push(`<span class="tag a">Announced</span>`);
  (p.protocols || []).slice(0, 4).forEach(x => tags.push(`<span class="tag">${esc(PROTO[x] || x)}</span>`));
  if (p.home_assistant && p.home_assistant !== "no") tags.push(`<span class="tag a">Home Assistant</span>`);
  if (p._gulf) tags.push(`<span class="tag g">UAE / Gulf price</span>`);
  const price = p._lo != null
    ? `<small>from</small><b>${money(usdTo(p._lo))}</b>${p.prices.length > 1 ? `<small>${p.prices.length} prices</small>` : ""}`
    : `<span class="none">No public price</span>`;
  return `<li class="row" tabindex="0" data-p="${esc(p.id)}"><div>
      <div class="t"><b>${esc(p.model)}</b><span class="by">${esc(p.vendor)}${p.family && p.family !== p.model ? " · " + esc(p.family) : ""}</span></div>
      ${p.description ? `<div class="desc">${esc(p.description)}</div>` : ""}
      ${tags.length ? `<div class="tags">${tags.join("")}</div>` : ""}
    </div><div class="price">${price}</div></li>`;
}
function vendorPanel(v) {
  if (!v) return "";
  const n = P.filter(p => p.vendor === v.name).length, cats = new Set(P.filter(p => p.vendor === v.name).map(p => p.domain)).size;
  const sw = (v.software || []).map(s => `<li><b>${esc(s.name)}</b>${s.type ? ` <span class="muted">· ${esc(s.type)}</span>` : ""}${(s.prices || []).map(q => ` · ${esc(q.currency)} ${esc(q.amount)}${q.period ? "/" + esc(q.period) : ""}`).join("")}${s.notes ? `<div class="muted">${esc(s.notes)}</div>` : ""}</li>`).join("");
  const sys = (v.systems || []).map(s => `<li><b>${esc(s.scenario)}</b> · ${esc(s.currency)} ${Number(s.amount).toLocaleString("en-US")}${s.includes ? ` <span class="muted">(${esc(s.includes)})</span>` : ""}${safeUrl(s.source) ? ` · <a href="${esc(s.source)}" target="_blank" rel="noopener">${esc(host(s.source))}</a>` : ""}</li>`).join("");
  return `<div class="vend"><h2>${esc(v.name)}</h2><div class="muted">${n} products across ${cats} categories</div>
    ${sw ? `<details><summary>Apps, software and subscriptions (${v.software.length})</summary><ul>${sw}</ul></details>` : ""}
    ${sys ? `<details><summary>Example system costs (${v.systems.length})</summary><ul>${sys}</ul></details>` : ""}</div>`;
}
function renderDrawer() {
  const p = BYID[S.p];
  $("drawer").hidden = $("scrim").hidden = !p;
  document.body.style.overflow = p ? "hidden" : "";
  if (!p) return;
  const prices = [...p.prices].sort((a, b) => (b.gulf || 0) - (a.gulf || 0) || a.usd - b.usd);
  const sib = P.filter(x => x !== p && x.vendor === p.vendor && p.family && x.family === p.family).slice(0, 12);
  const link = safeUrl(p.link);
  const compat = [
    p.protocols ? ["Connects over", p.protocols.map(x => PROTO[x] || x).join(", ")] : null,
    p.local_control ? ["Local control", { yes: "Yes, works without the cloud", partial: "Partly", "cloud-only": "No, needs the vendor cloud" }[p.local_control] || p.local_control] : null,
    p.home_assistant ? ["Home Assistant", { native: "Official integration", community: "Community integration", no: "Not supported" }[p.home_assistant] || p.home_assistant] : null,
  ].filter(Boolean);
  $("drawer").innerHTML = `
    <div class="dh"><div><div class="who">${esc(p.vendor)} · ${esc(CAT[p.domain]?.name || p.domain)}</div><h2>${esc(p.model)}</h2></div>
      <button class="ghost x" data-close aria-label="Close">✕</button></div>
    <div class="db">
      ${p.description ? `<p>${esc(p.description)}</p>` : ""}
      ${link ? `<a class="cta" href="${esc(link)}" target="_blank" rel="noopener">Manufacturer page ↗</a>` : ""}
      <h3>Details</h3>
      <dl class="kv">
        <dt>Brand</dt><dd><a data-go-brand="${esc(p.vendor)}" href="#">${esc(p.vendor)}</a></dd>
        ${p.family ? `<dt>Product line</dt><dd>${esc(p.family)}</dd>` : ""}
        <dt>Category</dt><dd><a data-go-cat="${esc(p.domain)}" href="#">${esc(CAT[p.domain]?.name || p.domain)}</a></dd>
        <dt>Status</dt><dd>${p.status === "announced" ? "Announced, not yet shipping" : "Current"}</dd>
        ${p.variant_count > 1 ? `<dt>Variants</dt><dd>${p.variant_count}</dd>` : ""}
        ${compat.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("")}
      </dl>
      ${(p.part_numbers || []).length ? `<h3>Part numbers</h3><div class="pn">${p.part_numbers.map(x => `<code title="Click to copy" data-copy="${esc(x)}">${esc(x)}</code>`).join("")}</div>` : ""}
      <h3>Prices</h3>
      ${prices.length ? `<table class="ptable"><thead><tr><th>Region</th><th>Source</th><th class="r">Price</th><th class="r">≈ ${CUR} ex VAT</th></tr></thead><tbody>
        ${prices.map(x => `<tr><td>${esc(x.region || "—")}<small>${esc(x.type)}${x.variant ? " · " + esc(x.variant) : ""}</small></td>
          <td>${safeUrl(x.source) ? `<a href="${esc(x.source)}" target="_blank" rel="noopener">${esc(host(x.source))}</a>` : "—"}<small>${x.seen ? "checked " + esc(x.seen) : ""}</small></td>
          <td class="r">${money(x.amount, x.currency, true)}${x.amount_max ? "–" + x.amount_max.toLocaleString("en-US") : ""}${x.vat_removed ? `<small>incl. ${Math.round(x.vat_removed * 100)}% VAT</small>` : ""}</td>
          <td class="r">${money(usdTo(x.usd))}</td></tr>`).join("")}</tbody></table>`
        : `<div class="note">No public price found. Products like this are usually sold through installers, who quote per project.</div>`}
      ${p.notes ? `<h3>Notes</h3><div class="note">${esc(p.notes)}</div>` : ""}
      ${sib.length ? `<h3>More in ${esc(p.family)}</h3><ul class="sib">${sib.map(x => `<li><a data-p="${esc(x.id)}">${esc(x.model)}</a><span>${x._lo != null ? money(usdTo(x._lo)) : ""}</span></li>`).join("")}</ul>` : ""}
    </div>`;
  $("drawer").scrollTop = 0;
}

// ---------- events ----------
function toggle(set, v) { set.has(v) ? set.delete(v) : set.add(v); }
function update() { shown = PAGE; render(); }
function bind() {
  let qt;
  $("q").addEventListener("input", e => { clearTimeout(qt); qt = setTimeout(() => { S.q = e.target.value.trim(); update(); }, 120); });
  $("brand-q").addEventListener("input", renderFilters);
  ["pmin", "pmax"].forEach(id => $(id).addEventListener("change", e => { S[id] = e.target.value; update(); }));
  ["priced", "gulf", "local", "ha"].forEach(k => $("f-" + k).addEventListener("change", e => { S[k] = e.target.checked; update(); }));
  $("f-ann").addEventListener("change", e => { S.ann = e.target.checked; update(); });
  $("sort").addEventListener("change", e => { S.sort = e.target.value; update(); });
  $("cur").addEventListener("change", e => {
    const old = CUR; CUR = e.target.value; store.set("cur", CUR);
    ["pmin", "pmax"].forEach(k => { if (S[k]) S[k] = String(Math.round(usdTo(fromUsd(+S[k], old)))); });
    syncInputs(); render();
  });
  $("more").addEventListener("click", () => { shown += PAGE * 2; renderResults(); });
  $("clear").addEventListener("click", clearAll);
  $("about-btn").addEventListener("click", () => $("about").showModal());
  $("open-filters").addEventListener("click", () => { $("filters").classList.add("open"); $("scrim").hidden = false; });
  $("close-filters").addEventListener("click", closeFilters);
  $("scrim").addEventListener("click", () => { closeFilters(); S.p = ""; render(); });
  document.addEventListener("click", e => {
    const t = e.target.closest("[data-cat],[data-brand],[data-proto],[data-go-cat],[data-go-brand],[data-p],[data-un],[data-close],[data-clear],[data-home],[data-copy]");
    if (!t) return;
    const d = t.dataset;
    if (d.copy) { navigator.clipboard?.writeText(d.copy); t.textContent = "Copied"; setTimeout(() => t.textContent = d.copy, 900); return; }
    e.preventDefault();
    if (d.cat) { toggle(S.cat, d.cat); update(); }
    else if (d.brand) { toggle(S.brand, d.brand); update(); }
    else if (d.proto) { toggle(S.proto, d.proto); update(); }
    else if (d.goCat) { resetFilters(); S.cat.add(d.goCat); update(); window.scrollTo(0, 0); }
    else if (d.goBrand) { resetFilters(); S.brand.add(d.goBrand); update(); window.scrollTo(0, 0); }
    else if (d.p) { S.p = d.p; render(); }
    else if (d.close) { S.p = ""; render(); }
    else if (d.clear || d.home !== undefined) { clearAll(); }
    else if (d.un) {
      const k = d.un;
      if (k === "q") S.q = ""; else if (k === "cat") S.cat.delete(d.v); else if (k === "brand") S.brand.delete(d.v);
      else if (k === "proto") S.proto.delete(d.v); else if (k === "price") S.pmin = S.pmax = ""; else if (k === "ann") S.ann = true; else S[k] = false;
      syncInputs(); update();
    }
  });
  $("list").addEventListener("keydown", e => { if (e.key === "Enter" && e.target.dataset.p) { S.p = e.target.dataset.p; render(); } });
  document.addEventListener("keydown", e => {
    if (e.key === "/" && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); $("q").focus(); }
    if (e.key === "Escape" && S.p) { S.p = ""; render(); }
  });
  window.addEventListener("hashchange", () => { readHash(); syncInputs(); render(); });
}
function resetFilters() { S.q = ""; S.cat.clear(); S.brand.clear(); S.proto.clear(); S.pmin = S.pmax = ""; ["priced", "gulf", "local", "ha"].forEach(k => S[k] = false); S.ann = true; S.p = ""; syncInputs(); }
function clearAll() { resetFilters(); update(); window.scrollTo(0, 0); }
function closeFilters() { $("filters").classList.remove("open"); if (!S.p) $("scrim").hidden = true; }

(async () => {
  try { await load(); }
  catch (err) { $("loading").textContent = "Couldn't load the catalogue. If you opened this file directly, serve the folder over HTTP instead."; return; }
  $("loading").hidden = true;
  readHash(); syncInputs(); bind(); render();
})();
