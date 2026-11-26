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

let D, P = [], BYID = {}, VEND = {}, shown = PAGE;
const S = { q: "", cat: new Set(), brand: new Set(), proto: new Set(), pmin: "", pmax: "", priced: false, gulf: false, local: false, ha: false, ann: true, sort: [], group: "cat", p: "" };
let lastScroll = 0, LAST = { rows: [], gk: null };

// ---------- money ----------
const CUR = "AED";
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
    // Search covers what is written about the product itself, not its category name.
    p._hay = [p.vendor, p.model, p.family, (p.part_numbers || []).join(" "), p.description].join(" ").toLowerCase();
    BYID[p.id] = p;
    return p;
  });
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
  if (S.sort.length) h.set("sort", S.sort.map(k => (k.desc ? "-" : "") + k.id).join(","));
  if (S.group !== "cat") h.set("group", S.group);
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
  S.ann = h.get("ann") !== "0"; S.sort = (h.get("sort") || "").split(",").filter(Boolean).map(x => ({ id: x.replace(/^-/, ""), desc: x[0] === "-" })).filter(k => COL[k.id]); S.p = h.get("p") || "";
  S.group = h.get("group") || "cat";
}
function syncInputs() {
  $("q").value = S.q; $("pmin").value = S.pmin; $("pmax").value = S.pmax; $("group").value = S.group;
  ["priced", "gulf", "local", "ha"].forEach(k => $("f-" + k).checked = S[k]); $("f-ann").checked = S.ann;
}

// ---------- render ----------
function render() {
  writeHash();
  const page = !!BYID[S.p];
  document.body.classList.toggle("on-page", page);
  $("filters").hidden = page;
  $("page").hidden = !page;
  if (page) { $("home").hidden = $("results").hidden = true; renderPage(); return; }
  renderFilters();
  const home = !anyFilter();
  document.body.classList.toggle("on-home", home);
  $("filters").hidden = home;
  $("home").hidden = !home; $("results").hidden = home;
  const search = document.querySelector(".search"), focused = document.activeElement === $("q");
  $("search-slot").appendChild(search);
  if (home) { renderHome(); $("home-search").appendChild(search); } else renderResults();
  if (focused) $("q").focus();
}
function openProduct(id) { if (!S.p) lastScroll = window.scrollY; S.p = id; render(); window.scrollTo(0, 0); }
function closeProduct() { S.p = ""; render(); requestAnimationFrame(() => window.scrollTo(0, lastScroll)); }
function countBy(skip, key) {
  const c = {}; for (const p of P) if (matches(p, skip)) c[p[key]] = (c[p[key]] || 0) + 1; return c;
}
function renderFilters() {
  const cc = countBy("cat", "domain");
  $("f-cat").innerHTML = GROUPS.map(([g, cs]) => {
    const items = cs.filter(([id]) => cc[id] || S.cat.has(id));
    if (!items.length) return "";
    return `<div class="fgroup"><b>${esc(g)}</b>${items.map(([id, name]) =>
      `<button class="opt${S.cat.has(id) ? " on" : ""}" data-cat="${id}">${esc(name)}<span class="n">${cc[id] || 0}</span></button>`).join("")}</div>`;
  }).join("");
  const bc = countBy("brand", "vendor"), bq = $("brand-q").value.trim().toLowerCase();
  $("f-brand").innerHTML = D.vendors.map(v => v.name).sort((a, b) => a.localeCompare(b))
    .filter(n => (bc[n] || S.brand.has(n)) && (!bq || n.toLowerCase().includes(bq) || S.brand.has(n)))
    .sort((a, b) => S.brand.has(b) - S.brand.has(a))
    .map(n => `<button class="opt${S.brand.has(n) ? " on" : ""}" data-brand="${esc(n)}">${esc(n)}<span class="n">${bc[n] || 0}</span></button>`).join("");
  const protos = [...new Set(P.flatMap(p => p.protocols || []))];
  $("f-proto").innerHTML = Object.keys(PROTO).filter(k => protos.includes(k))
    .map(k => `<button class="chip${S.proto.has(k) ? " on" : ""}" data-proto="${k}">${PROTO[k]}</button>`).join("");
  const n = S.cat.size + S.brand.size + S.proto.size + (S.pmin ? 1 : 0) + (S.pmax ? 1 : 0) + ["priced", "gulf", "local", "ha"].filter(k => S[k]).length;
  $("fcount").textContent = n ? `(${n})` : "";
}
function renderHome() {
  const cc = {}, bc = {};
  P.forEach(p => { cc[p.domain] = (cc[p.domain] || 0) + 1; bc[p.vendor] = (bc[p.vendor] || 0) + 1; });
  const opt = (attr, v, label, n) => `<button class="opt" ${attr}="${esc(v)}">${esc(label)}<span class="n">${n}</span></button>`;
  const names = Object.keys(bc).sort((a, b) => a.localeCompare(b));
  $("home").innerHTML = `
    <div class="home-top"><div id="home-search"></div>
      <div class="home-meta">${P.length.toLocaleString()} products · ${names.length} brands · ${P.filter(p => p._gulf).length} with Gulf prices</div></div>
    <section class="hsec"><h2>Categories</h2><div class="hcols">
      ${GROUPS.map(([g, cs]) => { const items = cs.filter(([id]) => cc[id]); return items.length ? `<div class="fgroup"><b>${esc(g)}</b>${items.map(([id, name]) => opt("data-go-cat", id, name, cc[id])).join("")}</div>` : ""; }).join("")}
    </div></section>
    <section class="hsec"><h2>Brands</h2><div class="hcols brands-cols">${names.map(n => opt("data-go-brand", n, n, bc[n])).join("")}</div></section>
    <section class="hsec"><h2>Quick filters</h2><div class="hcols">
      <div class="fgroup">
        <button class="opt" data-go-flag="gulf">Priced in the UAE / Gulf<span class="n">${P.filter(p => p._gulf).length}</span></button>
        <button class="opt" data-go-flag="priced">Has a public price<span class="n">${P.filter(p => p._lo != null).length}</span></button>
      </div></div></section>`;
}
// Sortable columns. Click a header to sort ascending, again for descending, a third time to clear.
// Shift-click adds the column as a secondary sort. Empty values always sort last.
const COLS = [
  { id: "name", label: "Product", get: p => p.model },
  { id: "brand", label: "Brand", get: p => p.vendor, hide: () => S.group === "brand" || S.group === "line" || S.brand.size === 1 },
  { id: "line", label: "Product line", get: p => p.family || null, hide: () => S.group === "line", cls: "c-line" },
  { id: "cat", label: "Category", get: p => CAT[p.domain]?.name || p.domain, hide: () => S.group === "cat" || S.cat.size === 1, cls: "c-cat" },
  { id: "price", label: "From", get: p => p._lo, num: true },
  { id: "gulf", label: "Gulf price", get: p => p._gulf ? p._gulf.usd : null, num: true, cls: "c-gulf" },
  { id: "n", label: "Prices", get: p => p.prices.length || null, num: true, cls: "c-n" },
];
const COL = Object.fromEntries(COLS.map(c => [c.id, c]));
function sortCmp() {
  const keys = S.sort.filter(k => COL[k.id]);
  if (!keys.length) return null;
  return (a, b) => {
    for (const { id, desc } of keys) {
      const c = COL[id], x = c.get(a), y = c.get(b);
      if (x == null || y == null) { if (x !== y) return x == null ? 1 : -1; continue; }
      const r = c.num ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: "base" });
      if (r) return desc ? -r : r;
    }
    return a.vendor.localeCompare(b.vendor) || a.model.localeCompare(b.model);
  };
}
function clickSort(id, add) {
  const i = S.sort.findIndex(k => k.id === id), cur = S.sort[i];
  const next = !cur ? { id, desc: false } : !cur.desc ? { id, desc: true } : null;
  if (add) { if (cur) S.sort.splice(i, 1, ...(next ? [next] : [])); else S.sort.push(next); }
  else S.sort = next ? [next] : [];
  update();
}
function renderResults() {
  const t = terms();
  let rows = P.filter(p => matches(p));
  const name = (a, b) => a.vendor.localeCompare(b.vendor) || a.model.localeCompare(b.model);
  const def = t.length ? (a, b) => score(b, t) - score(a, t) || name(a, b)
    : (a, b) => catOrder(a.domain) - catOrder(b.domain) || ((b._lo != null) - (a._lo != null)) || name(a, b);
  rows.sort(sortCmp() || def);
  const gk = groupKey();
  if (gk) {
    const first = new Map(); rows.forEach((p, i) => { const k = gk.key(p); if (!first.has(k)) first.set(k, i); });
    const keys = [...first.keys()].sort(gk.order || ((a, b) => !S.sort.length && t.length ? first.get(a) - first.get(b) : a.localeCompare(b)));
    const by = new Map(keys.map(k => [k, []])); rows.forEach(p => by.get(gk.key(p)).push(p));
    rows = keys.flatMap(k => by.get(k));
    rows._groups = by;
  }
  LAST = { rows, gk };
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
  $("sortinfo").innerHTML = S.sort.length ? `Sorted by ${S.sort.map(k => `${esc(COL[k.id]?.label)} ${k.desc ? "↓" : "↑"}`).join(", then ")} · <button class="link" data-unsort>Reset</button>`
    : `<span class="muted">Click a column to sort${gk ? " within each group" : ""}. Shift-click to add a second sort.</span>`;
  $("vendor").innerHTML = S.brand.size === 1 ? vendorPanel(VEND[[...S.brand][0]]) : "";
  const cols = COLS.filter(c => !c.hide?.());
  const head = `<thead><tr>${cols.map(c => {
    const i = S.sort.findIndex(k => k.id === c.id), k = S.sort[i];
    return `<th class="${c.num ? "r " : ""}${c.cls || ""}${k ? " sorted" : ""}" aria-sort="${k ? (k.desc ? "descending" : "ascending") : "none"}">
      <button data-sort="${c.id}" title="Sort by ${esc(c.label)}">${esc(c.label)}${c.num && c.id !== "n" ? ` <span class="unit">AED</span>` : ""}<span class="arr">${k ? (k.desc ? "↓" : "↑") : "↕"}</span>${k && S.sort.length > 1 ? `<sup>${i + 1}</sup>` : ""}</button></th>`;
  }).join("")}</tr></thead>`;
  const vis = rows.slice(0, shown), table = ps => `<table class="grid">${head}<tbody>${ps.map(p => rowHtml(p, cols)).join("")}</tbody></table>`;
  let html = "";
  if (!rows.length) html = `<div class="empty">No products match these filters. <button class="link" data-clear>Clear filters</button></div>`;
  else if (!gk) html = table(vis);
  else {
    const parts = new Map(); vis.forEach(p => { const k = gk.key(p); if (!parts.has(k)) parts.set(k, []); parts.get(k).push(p); });
    html = [...parts].map(([k, ps]) => `<section class="gsec">${groupHead(gk, k, rows._groups.get(k))}${table(ps)}</section>`).join("");
  }
  $("list").innerHTML = html;
  $("more-wrap").hidden = rows.length <= shown;
  $("more").textContent = `Show more (${(rows.length - shown).toLocaleString()} left)`;
}
function groupKey() {
  if (S.group === "cat") return { kind: "cat", key: p => p.domain, order: (a, b) => catOrder(a) - catOrder(b), label: k => CAT[k]?.name || k, sub: k => CAT[k]?.group || "" };
  if (S.group === "brand") return { kind: "brand", key: p => p.vendor, label: k => k, sub: () => "" };
  if (S.group === "line") return { kind: "line", key: p => `${p.vendor} · ${p.family || "Other"}`, label: k => k, sub: () => "" };
  return null;
}
function groupHead(gk, k, items) {
  const filt = gk.kind === "cat" ? (S.cat.size === 1 && S.cat.has(k) ? "" : `<button class="link only" data-go-cat="${esc(k)}" data-keep>Show only this</button>`)
    : gk.kind === "brand" ? (S.brand.size === 1 && S.brand.has(k) ? "" : `<button class="link only" data-go-brand="${esc(k)}" data-keep>Show only this</button>`) : "";
  const brands = gk.kind === "cat" ? new Set(items.map(p => p.vendor)).size : 0;
  return `<header class="ghead"><h2>${esc(gk.label(k))}</h2><span class="n">${items.length} product${items.length === 1 ? "" : "s"}${brands ? ` · ${brands} brand${brands > 1 ? "s" : ""}` : ""}</span>
    <span class="gact">${filt}<button class="ghost sm" data-export="${esc(k)}">Export CSV</button></span></header>`;
}
const ORDER = GROUPS.flatMap(([, cs]) => cs.map(([id]) => id));
const catOrder = d => { const i = ORDER.indexOf(d); return i < 0 ? 99 : i; };
// ---------- CSV export ----------
function exportCsv(key) {
  const rows = key == null ? LAST.rows : LAST.rows._groups.get(key) || [];
  const base = location.href.split("#")[0];
  const head = ["Brand", "Product", "Product line", "Category", "Part numbers", "Status", "Description",
    "Lowest price (AED, ex VAT)", "Gulf price (AED, ex VAT)", "Gulf price as listed", "Gulf price source",
    "All prices", "Manufacturer page", "Image", "Directory link"];
  const q = v => { const t = String(v ?? ""); return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const aed = v => v == null ? "" : Math.round(usdTo(v));
  const lines = [head, ...rows.map(p => [p.vendor, p.model, p.family || "", CAT[p.domain]?.name || p.domain, (p.part_numbers || []).join(" "),
    p.status || "", p.description || "", aed(p._lo), p._gulf ? aed(p._gulf.usd) : "",
    p._gulf ? `${p._gulf.currency} ${p._gulf.amount}` : "", p._gulf?.source || "",
    p.prices.map(x => `${x.currency} ${x.amount} ${x.type} ${x.region || ""} (${host(x.source)}, ${x.seen || ""})`).join("; "),
    p.link || "", p.image || "", `${base}#p=${p.id}`])].map(r => r.map(q).join(","));
  const label = key == null ? "smart-home-hardware" : `smart-home-hardware-${LAST.gk?.label(key) || key}`;
  const name = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + ".csv";
  const url = URL.createObjectURL(new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
// When a search term only matches a hidden field (part number, line, brand), say where it matched.
function matchNote(p) {
  const t = terms();
  if (!t.length) return "";
  const seen = (p.model + " " + (p.description || "")).toLowerCase();
  const hidden = t.filter(w => !seen.includes(w));
  if (!hidden.length) return "";
  const pn = (p.part_numbers || []).filter(x => hidden.some(w => x.toLowerCase().includes(w)));
  if (pn.length) return `<div class="why">Part number ${hl(pn.slice(0, 3).join(", "))}</div>`;
  if (hidden.some(w => (p.family || "").toLowerCase().includes(w))) return `<div class="why">Line: ${hl(p.family)}</div>`;
  return "";
}
function rowHtml(p, cols) {
  const tags = [];
  if (p.status === "announced") tags.push(`<span class="tag a">Announced</span>`);
  (p.protocols || []).slice(0, 4).forEach(x => tags.push(`<span class="tag">${esc(PROTO[x] || x)}</span>`));
  if (p.home_assistant && p.home_assistant !== "no") tags.push(`<span class="tag ok">Home Assistant</span>`);
  const cell = {
    name: () => `<td class="c-name"><div class="pcell">${thumb(p, "th")}<div>
        <a class="t" href="#p=${esc(p.id)}" data-p="${esc(p.id)}">${hl(p.model)}</a>
        ${p.description ? `<div class="desc">${hl(p.description)}</div>` : ""}
        ${matchNote(p)}
        ${tags.length ? `<div class="tags">${tags.join("")}</div>` : ""}</div></div></td>`,
    brand: () => `<td><a href="#" class="plain" data-go-brand="${esc(p.vendor)}" data-keep>${esc(p.vendor)}</a></td>`,
    line: () => `<td class="c-line muted">${esc(p.family || "")}</td>`,
    cat: () => `<td class="c-cat muted">${esc(CAT[p.domain]?.name || p.domain)}</td>`,
    price: () => `<td class="r"><b>${p._lo != null ? money(usdTo(p._lo)) : ""}</b>${p._lo == null ? `<span class="none">On request</span>` : ""}</td>`,
    gulf: () => `<td class="r c-gulf">${p._gulf ? `<span class="gp">${money(usdTo(p._gulf.usd))}</span>` : ""}</td>`,
    n: () => `<td class="r c-n muted">${p.prices.length || ""}</td>`,
  };
  return `<tr class="prow">${cols.map(c => cell[c.id]()).join("")}</tr>`;
}
// Escape text and wrap the current search terms in <mark>.
function hl(text) {
  const t = terms();
  if (!t.length || !text) return esc(text);
  const re = new RegExp(`(${t.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return String(text).split(re).map((part, i) => i % 2 ? `<mark>${esc(part)}</mark>` : esc(part)).join("");
}
function thumb(p, cls) {
  const src = safeUrl(p.image);
  return `<a class="${cls}${src ? "" : " noimg"}" href="#p=${esc(p.id)}" data-p="${esc(p.id)}" aria-hidden="true" tabindex="-1">${src
    ? `<img src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentElement.classList.add('noimg');this.remove()">` : ""}</a>`;
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
function renderPage() {
  const p = BYID[S.p];
  const prices = [...p.prices].sort((a, b) => (b.gulf || 0) - (a.gulf || 0) || a.usd - b.usd);
  const line = P.filter(x => x !== p && x.vendor === p.vendor && p.family && x.family === p.family);
  const alts = P.filter(x => x.domain === p.domain && x.vendor !== p.vendor)
    .map(x => [x, p._lo != null && x._lo != null ? Math.abs(Math.log(x._lo / p._lo)) : p._lo == null ? (x._lo == null ? 1 : 2) : 9])
    .sort((a, b) => a[1] - b[1]).slice(0, 10).map(a => a[0]);
  const link = safeUrl(p.link), cat = CAT[p.domain];
  const compat = [
    p.protocols ? ["Connects over", p.protocols.map(x => PROTO[x] || x).join(", ")] : null,
    p.local_control ? ["Local control", { yes: "Yes", partial: "Partly", "cloud-only": "Cloud only" }[p.local_control] || p.local_control] : null,
    p.home_assistant ? ["Home Assistant", { native: "Official", community: "Community", no: "No" }[p.home_assistant] || p.home_assistant] : null,
  ].filter(Boolean);
  const mini = xs => `<ul class="mini-list">${xs.map(x => `<li><a href="#p=${esc(x.id)}" data-p="${esc(x.id)}"><span><b>${esc(x.model)}</b><span class="by">${esc(x.vendor === p.vendor ? (x.family || "") : x.vendor)}</span></span><span class="p">${x._lo != null ? money(usdTo(x._lo)) : "—"}</span></a></li>`).join("")}</ul>`;
  const tags = [];
  if (p.status === "announced") tags.push(`<span class="tag a">Announced</span>`);
  (p.protocols || []).forEach(x => tags.push(`<span class="tag">${esc(PROTO[x] || x)}</span>`));
  if (p.home_assistant && p.home_assistant !== "no") tags.push(`<span class="tag ok">Home Assistant</span>`);
  if (p.local_control === "yes") tags.push(`<span class="tag ok">Local control</span>`);
  if (p._gulf) tags.push(`<span class="tag g">Priced in the Gulf</span>`);
  $("page").innerHTML = `
    <button class="back" data-close>← Back to ${anyFilter() ? "results" : "directory"}</button>
    <header class="ph">
      <div class="trail"><a href="#" data-go-cat="${esc(p.domain)}">${esc(cat?.name || p.domain)}</a><span>/</span><a href="#" data-go-brand="${esc(p.vendor)}">${esc(p.vendor)}</a>${p.family ? `<span>/</span><span class="muted">${esc(p.family)}</span>` : ""}</div>
      <h1>${esc(p.model)}</h1>
      ${p.description ? `<p class="lede">${esc(p.description)}</p>` : ""}
      ${tags.length ? `<div class="tags">${tags.join("")}</div>` : ""}
    </header>
    <div class="pgrid">
      <div>
        <section class="psec"><h2>Prices <small>${prices.length ? `${prices.length} found · converted to ${CUR}, excluding VAT` : ""}</small></h2>
          ${prices.length ? `<table class="ptable"><thead><tr><th>Region</th><th>Where</th><th class="r">Listed price</th><th class="r">≈ ${CUR} ex VAT</th></tr></thead><tbody>
            ${prices.map(x => `<tr class="${x.gulf ? "gulf" : ""}"><td><b>${esc(x.region || "—")}</b><small>${esc(x.type)}${x.variant ? " · " + esc(x.variant) : ""}</small></td>
              <td>${safeUrl(x.source) ? `<a href="${esc(x.source)}" target="_blank" rel="noopener">${esc(host(x.source))}</a>` : "—"}<small>${x.seen ? "checked " + esc(x.seen) : ""}</small></td>
              <td class="r">${money(x.amount, x.currency, true)}${x.amount_max ? "–" + x.amount_max.toLocaleString("en-US") : ""}${x.vat_removed ? `<small>incl. ${Math.round(x.vat_removed * 100)}% VAT</small>` : ""}</td>
              <td class="r">${money(usdTo(x.usd))}</td></tr>`).join("")}</tbody></table>`
            : `<div class="note">No public price found. Products like this are usually sold through installers, who quote per project.</div>`}
        </section>
        ${(p.part_numbers || []).length ? `<section class="psec"><h2>Part numbers <small>${p.part_numbers.length} · click to copy</small></h2><div class="pn">${p.part_numbers.map(x => `<code data-copy="${esc(x)}">${esc(x)}</code>`).join("")}</div></section>` : ""}
        ${p.notes ? `<section class="psec"><h2>Notes</h2><div class="note">${esc(p.notes)}</div></section>` : ""}
        ${line.length ? `<section class="psec"><h2>More in ${esc(p.family)} <small>${line.length}</small></h2>${mini(line.slice(0, 20))}${line.length > 20 ? `<p><a href="#" data-go-line>See all ${line.length}</a></p>` : ""}</section>` : ""}
        ${alts.length ? `<section class="psec"><h2>Alternatives from other brands <small>${esc(cat?.name || "")}${p._lo != null ? ", closest in price" : ""}</small></h2>${mini(alts)}</section>` : ""}
      </div>
      <aside class="pside">
        ${safeUrl(p.image) ? `<div class="pimg"><img src="${esc(p.image)}" alt="${esc(p.model)}" referrerpolicy="no-referrer" onerror="this.parentElement.remove()"></div>` : ""}
        <div class="card">
          <div class="k">${p._lo != null ? "Lowest public price" : "Price"}</div>
          <div class="big">${p._lo != null ? money(usdTo(p._lo)) : "On request"}</div>
          <div class="muted" style="font-size:13px">${p._lo != null ? `ex VAT, across ${p._regions.length} region${p._regions.length === 1 ? "" : "s"}` : "Sold through installers"}</div>
          ${p._gulf ? `<div class="gl"><div class="k">Gulf price</div><div style="font-weight:650;font-size:18px" class="num">${money(p._gulf.amount, p._gulf.currency, true)}</div><div class="muted" style="font-size:13px">${esc(p._gulf.region)} · ${esc(host(p._gulf.source))}</div></div>` : ""}
          ${link ? `<a class="btn" href="${esc(link)}" target="_blank" rel="noopener">${p.link_kind === "line" ? "Product line page" : "Manufacturer page"} ↗</a>` : ""}
        </div>
        <div class="card">
          <dl class="facts">
            <dt>Brand</dt><dd><a href="#" data-go-brand="${esc(p.vendor)}">${esc(p.vendor)}</a></dd>
            ${p.family ? `<dt>Product line</dt><dd>${esc(p.family)}</dd>` : ""}
            <dt>Category</dt><dd><a href="#" data-go-cat="${esc(p.domain)}">${esc(cat?.name || p.domain)}</a></dd>
            <dt>Status</dt><dd>${p.status === "announced" ? "Announced" : "Current"}</dd>
            ${p.variant_count > 1 ? `<dt>Variants</dt><dd>${p.variant_count}</dd>` : ""}
            ${compat.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("")}
          </dl>
        </div>
      </aside>
    </div>`;
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
  $("group").addEventListener("change", e => { S.group = e.target.value; update(); });
  $("more").addEventListener("click", () => { shown += PAGE * 2; renderResults(); });
  $("clear").addEventListener("click", clearAll);
  $("open-filters").addEventListener("click", () => { $("filters").classList.add("open"); $("scrim").hidden = false; });
  $("close-filters").addEventListener("click", closeFilters);
  $("scrim").addEventListener("click", closeFilters);
  document.addEventListener("click", e => {
    const t = e.target.closest("[data-cat],[data-brand],[data-proto],[data-go-cat],[data-go-brand],[data-go-line],[data-go-flag],[data-sort],[data-unsort],[data-export],[data-export-all],[data-p],[data-un],[data-close],[data-clear],[data-home],[data-copy]");
    if (!t) return;
    const d = t.dataset;
    if (d.sort) { clickSort(d.sort, e.shiftKey); return; }
    if ("exportAll" in d) { exportCsv(null); return; }
    if ("export" in d) { exportCsv(d.export); return; }
    if ("unsort" in d) { S.sort = []; update(); return; }
    if (d.copy) { navigator.clipboard?.writeText(d.copy); t.textContent = "Copied"; setTimeout(() => t.textContent = d.copy, 900); return; }
    e.preventDefault();
    if (d.cat) { toggle(S.cat, d.cat); update(); }
    else if (d.brand) { toggle(S.brand, d.brand); update(); }
    else if (d.proto) { toggle(S.proto, d.proto); update(); }
    else if (d.goCat !== undefined) { if (d.keep === undefined) resetFilters(); S.p = ""; S.cat = new Set([d.goCat]); update(); window.scrollTo(0, 0); }
    else if (d.goBrand !== undefined) { if (d.keep === undefined) resetFilters(); S.p = ""; S.brand = new Set([d.goBrand]); update(); window.scrollTo(0, 0); }
    else if (d.goLine !== undefined) { const p = BYID[S.p]; resetFilters(); S.brand.add(p.vendor); S.q = p.family; S.group = "line"; syncInputs(); update(); window.scrollTo(0, 0); }
    else if (d.goFlag) { resetFilters(); S[d.goFlag] = true; syncInputs(); update(); window.scrollTo(0, 0); }
    else if (d.p) { openProduct(d.p); }
    else if ("close" in d) { closeProduct(); }
    else if ("clear" in d || "home" in d) { clearAll(); }
    else if (d.un) {
      const k = d.un;
      if (k === "q") S.q = ""; else if (k === "cat") S.cat.delete(d.v); else if (k === "brand") S.brand.delete(d.v);
      else if (k === "proto") S.proto.delete(d.v); else if (k === "price") S.pmin = S.pmax = ""; else if (k === "ann") S.ann = true; else S[k] = false;
      syncInputs(); update();
    }
  });
  document.addEventListener("keydown", e => {
    if (e.key === "/" && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); $("q").focus(); }
    if (e.key === "Escape" && S.p) closeProduct();
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
