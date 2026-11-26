#!/usr/bin/env python3
"""Build data/catalog.json and data/products.csv from a source catalogue directory.

Usage: python3 scripts/export.py <catalogue-dir> [images-dir]

images-dir defaults to a catalog-images folder next to the catalogue, holding <slug>.json files
that map model names to image URLs.

The source holds one JSON file per vendor. Only public product information is copied:
dealer, distributor and bulk prices, sourcing, manufacturer and margin fields are dropped.
"""
import csv, json, re, sys
from pathlib import Path

# USD value of one unit of each currency. Gulf pegs are exact; the rest are approximate reference rates.
FX = {"USD": 1, "AED": 1 / 3.6725, "SAR": 1 / 3.75, "QAR": 1 / 3.64, "OMR": 2.6, "BHD": 2.659, "KWD": 3.26,
      "EUR": 1.08, "GBP": 1.27, "CHF": 1.13, "SEK": 0.095, "NOK": 0.093, "DKK": 0.145, "PLN": 0.25, "CZK": 0.043,
      "HUF": 0.0027, "RON": 0.217, "TRY": 0.029, "AUD": 0.65, "NZD": 0.6, "CAD": 0.73, "CNY": 0.138, "HKD": 0.128,
      "JPY": 0.0066, "KRW": 0.00072, "INR": 0.012, "SGD": 0.74, "ZAR": 0.055, "UAH": 0.024, "BRL": 0.18,
      "MXN": 0.055, "RUB": 0.011, "ILS": 0.27, "EGP": 0.02, "MYR": 0.22, "THB": 0.029, "IDR": 0.000063, "TWD": 0.031}
VAT = {"DE": .19, "AT": .20, "NL": .21, "BE": .21, "FR": .20, "IT": .22, "ES": .21, "PT": .23, "IE": .23, "UK": .20,
       "GB": .20, "CZ": .21, "HU": .27, "LT": .21, "EE": .22, "PL": .23, "SE": .25, "DK": .25, "NO": .25, "FI": .255,
       "CH": .081, "UA": .20, "AE": .05, "UAE": .05, "SA": .15, "KSA": .15, "AU": .10, "NZ": .15, "TR": .20,
       "IN": .18, "JP": .10}
PUBLIC_PRICE = {"msrp", "list", "retail", "street"}
GULF = re.compile(r"UAE|\bAE\b|KSA|Saudi|Qatar|Kuwait|Bahrain|Oman|GCC|Dubai|Abu Dhabi|Riyadh", re.I)
MODEL_FIELDS = ["domain", "family", "model", "part_numbers", "variant_count", "description", "status", "notes",
                "protocols", "local_control", "home_assistant"]


def vat_rate(region):
    m = re.match(r"[A-Z]{2,3}", str(region or "").upper())
    return VAT.get(m.group(0), 0) if m else 0


def incl_vat(p):
    t = f"{p.get('vat') or ''} {p.get('note') or ''} {p.get('region') or ''}".lower()
    if re.search(r"excl|ex[ .-]?vat|ex[ .-]?gst|before vat|net of vat|netto|ex sales tax", t):
        return False
    return bool(re.search(r"incl|inc\.? ?vat|with vat|gross|brutto|ttc|mwst|iva incl", t))


def price(p):
    if p.get("type") not in PUBLIC_PRICE or not isinstance(p.get("amount"), (int, float)):
        return None
    rate = FX.get(str(p.get("currency") or "").upper())
    if not rate:
        return None
    vat = vat_rate(p.get("region")) if incl_vat(p) else 0
    out = {k: p[k] for k in ("amount", "amount_max", "currency", "type", "region", "source", "seen", "variant", "sku")
           if p.get(k) not in (None, "")}
    out["usd"] = round(p["amount"] * rate / (1 + vat), 2)
    if vat:
        out["vat_removed"] = vat
    if GULF.search(str(p.get("region") or "")):
        out["gulf"] = True
    return out


PRIVATE_NOTE = re.compile(r"made_by|\bODM\b|\bOEM\b|margin|sourcing|dealer cost|markup|revenue|per share", re.I)


def public_notes(s):
    """Drop sentences of research notes that discuss sourcing or margins."""
    parts = re.split(r"(?<=[.;])\s+", s or "")
    return " ".join(x for x in parts if x and not PRIVATE_NOTE.search(x)).strip()


def slugify(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def main(src, img_dir=None):
    img_dir = Path(img_dir) if img_dir else Path(src).resolve().parent / "catalog-images"
    vendors, products = [], []
    for f in sorted(Path(src).glob("*.json")):
        j = json.loads(f.read_text())
        if not isinstance(j.get("models"), list) or not j["models"]:
            continue
        name = j["Company"]
        imgs = {}
        if (img_dir / f.name).exists():
            imgs = {k: v for k, v in json.loads((img_dir / f.name).read_text()).items()
                    if not k.startswith("_") and isinstance(v, dict) and str(v.get("image", "")).startswith("https://")}
        vendors.append({
            "name": name, "slug": f.stem,
            "software": [{**{k: s[k] for k in ("name", "type") if s.get(k)}, **({"notes": public_notes(s["notes"])} if public_notes(s.get("notes")) else {}),
                          "prices": [{k: q[k] for k in ("amount", "currency", "period", "region", "source") if q.get(k)}
                                     for q in s.get("prices") or [] if q.get("type", "list") in PUBLIC_PRICE]}
                         for s in j.get("software_and_services") or [] if s.get("type") != "dealer-tool"],
            "systems": [{k: s[k] for k in ("scenario", "amount", "currency", "includes", "source") if s.get(k) is not None}
                        for s in j.get("typical_system_costs") or []],
            "updated": j.get("updated"),
        })
        seen = set()
        for m in j["models"]:
            p = {k: m[k] for k in MODEL_FIELDS if m.get(k) not in (None, "", [])}
            p["vendor"] = name
            if "notes" in p:
                p["notes"] = public_notes(p["notes"])
                if not p["notes"]:
                    del p["notes"]
            if PRIVATE_NOTE.search(p.get("description", "")):
                p["description"] = public_notes(p["description"])
            base = slugify(f"{f.stem}-{m.get('model', '')}")
            pid, i = base, 2
            while pid in seen:
                pid, i = f"{base}-{i}", i + 1
            seen.add(pid)
            p["id"] = pid
            link = m.get("product_page") or m.get("product_url")
            if link:
                p["link"] = link
            if m.get("model") in imgs:
                p["image"] = imgs[m["model"]]["image"]
            p["prices"] = [x for x in map(price, m.get("prices") or []) if x]
            products.append(p)
    out = Path(__file__).resolve().parent.parent / "data"
    out.mkdir(exist_ok=True)
    (out / "catalog.json").write_text(json.dumps(
        {"generated": __import__("datetime").date.today().isoformat(), "fx_usd": FX, "vendors": vendors, "products": products},
        ensure_ascii=False, separators=(",", ":")))
    with open(out / "products.csv", "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["vendor", "category", "family", "model", "part_numbers", "status", "description", "protocols",
                    "local_control", "home_assistant", "lowest_price_usd_net", "lowest_gulf_price_aed", "link"])
        for p in products:
            us = [x["usd"] for x in p["prices"]]
            gulf = [x["usd"] * 3.6725 for x in p["prices"] if x.get("gulf")]
            w.writerow([p["vendor"], p["domain"], p.get("family", ""), p["model"], " ".join(p.get("part_numbers", [])),
                        p.get("status", ""), p.get("description", ""), " ".join(p.get("protocols", [])),
                        p.get("local_control", ""), p.get("home_assistant", ""), f"{min(us):.2f}" if us else "",
                        f"{min(gulf):.0f}" if gulf else "", p.get("link", "")])
    print(f"{len(vendors)} vendors, {len(products)} products, {sum(bool(p['prices']) for p in products)} priced, "
          f"{sum('image' in p for p in products)} with images")


if __name__ == "__main__":
    if len(sys.argv) not in (2, 3):
        sys.exit(__doc__)
    main(*sys.argv[1:])
