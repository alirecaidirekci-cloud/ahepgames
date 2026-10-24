"""Builds data/pool.json: a large footballer list (name, nationalities, clubs) used by
Team & Nation Guess to show the game admin which players fit both picks.

Usage:
  py scripts/build_pool.py fetch   # download from Wikidata -> scripts/pool_raw.json (a few minutes)
  py scripts/build_pool.py build   # pool_raw.json -> data/pool.json

Takes the most famous footballers worldwide (by number of Wikipedia language editions) plus the
most famous players who ever played for a Süper Lig club. Club cleaning (youth/reserve teams,
duplicate entries) follows build_players.py.
"""
import json
import os
import sys
import time
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_players import CLUB_MERGE, NAME_FIX, YOUTH_WORDS, UA  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "scripts", "pool_raw.json")
GLOBAL_LIMIT = 4000
SUPERLIG_LIMIT = 1500


def get(url):
    for attempt in range(6):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=180) as r:
                return json.load(r)
        except Exception as e:  # noqa: BLE001
            print("  retry", attempt, e, file=sys.stderr)
            time.sleep(65)
    raise RuntimeError("request failed: " + url[:120])


def sparql_ids(query):
    url = "https://query.wikidata.org/sparql?" + urllib.parse.urlencode({"query": query, "format": "json"})
    return [b["p"]["value"].rsplit("/", 1)[-1] for b in get(url)["results"]["bindings"]]


def entities(ids, props):
    out = {}
    ids = list(ids)
    for i in range(0, len(ids), 50):
        url = "https://www.wikidata.org/w/api.php?" + urllib.parse.urlencode({
            "action": "wbgetentities", "ids": "|".join(ids[i:i + 50]), "props": props, "languages": "en|tr", "format": "json"})
        out.update(get(url).get("entities", {}))
        time.sleep(0.2)
        if i % 1000 == 0:
            print("  entities", i, "/", len(ids))
    return out


def claim_ids(ent, prop, keep_rank=False):
    res = []
    for c in ent.get("claims", {}).get(prop, []):
        dv = c["mainsnak"].get("datavalue")
        if dv and isinstance(dv["value"], dict) and "id" in dv["value"] and c.get("rank") != "deprecated":
            res.append((dv["value"]["id"], c.get("rank")) if keep_rank else dv["value"]["id"])
    return res


def fetch():
    glob = sparql_ids("""SELECT ?p WHERE {
      ?p wdt:P106 wd:Q937857; wikibase:sitelinks ?l. FILTER(?l > 12)
    } ORDER BY DESC(?l) LIMIT %d""" % GLOBAL_LIMIT)
    print("global", len(glob))
    time.sleep(65)
    sl = sparql_ids("""SELECT ?p (MAX(?l) AS ?links) WHERE {
      ?club wdt:P118 wd:Q485568.
      ?p wdt:P54 ?club; wdt:P106 wd:Q937857; wikibase:sitelinks ?l.
    } GROUP BY ?p ORDER BY DESC(?links) LIMIT %d""" % SUPERLIG_LIMIT)
    print("superlig", len(sl))
    ids = list(dict.fromkeys(glob + sl))
    players = entities(ids, "labels|claims")
    slim = {}
    clubs = set()
    nats = set()
    for k, e in players.items():
        c = e.get("claims", {})
        p54 = claim_ids(e, "P54")
        clubs.update(p54)
        n = claim_ids(e, "P1532", True) + claim_ids(e, "P27", True)
        nats.update(x for x, _ in n)
        slim[k] = {"labels": e.get("labels", {}), "p54": p54, "p1532": claim_ids(e, "P1532", True), "p27": claim_ids(e, "P27", True),
                   "male": "Q6581097" in claim_ids(e, "P21")}
    print("clubs", len(clubs), "countries", len(nats))
    club_ents = entities(sorted(clubs), "labels|claims")
    club_slim = {k: {"labels": v.get("labels", {}), "p31": claim_ids(v, "P31")} for k, v in club_ents.items()}
    nat_ents = entities(sorted(nats), "labels|claims")
    nat_slim = {k: {"labels": v.get("labels", {}), "p30": claim_ids(v, "P30")} for k, v in nat_ents.items()}
    with open(RAW, "w", encoding="utf-8") as f:
        json.dump({"glob": glob, "sl": sl, "players": slim, "clubs": club_slim, "nations": nat_slim}, f, ensure_ascii=False)
    print("saved", RAW)


def lab(d, lang):
    return (d or {}).get("labels", {}).get(lang, {}).get("value")


def build():
    raw = json.load(open(RAW, encoding="utf-8"))
    P, C, N = raw["players"], raw["clubs"], raw["nations"]
    # Countries: keep real countries/teams that have a continent (drops regions like "Euskal-Erria").
    def nat_ok(n):
        return n in N and N[n]["p30"]
    clubs_used, nats_used, out = {}, {}, []
    for pid in dict.fromkeys(raw["glob"] + raw["sl"]):
        e = P.get(pid)
        if not e or not e["male"]:
            continue
        name = NAME_FIX.get(pid) or lab(e, "en") or lab(e, "tr")
        if not name:
            continue
        # Nationalities: country for sport (preferred first), else citizenship.
        sport = sorted(e["p1532"], key=lambda x: x[1] != "preferred")
        nats = [n for n, _ in sport if nat_ok(n)] or [n for n, _ in sorted(e["p27"], key=lambda x: x[1] != "preferred") if nat_ok(n)]
        nats = list(dict.fromkeys(nats))[:2]
        cl = []
        for c in e["p54"]:
            c = CLUB_MERGE.get(c, c)
            ce = C.get(c)
            cname = lab(ce, "en")
            if not ce or not cname or "national" in cname.lower():
                continue
            if "Q6979593" in ce["p31"]:
                continue
            if cname.endswith((" B", " C", " II", " Atlètic", " Castilla", " U19", " U21", " U23")) or any(w in cname for w in YOUTH_WORDS):
                continue
            if "Reserves" in cname or "Youth" in cname or "Primavera" in cname:
                continue
            if c not in cl:
                cl.append(c)
        if not nats or not cl:
            continue
        out.append([name, nats, cl])
        for n in nats:
            nats_used[n] = {"en": lab(N[n], "en"), "tr": lab(N[n], "tr") or lab(N[n], "en")}
        for c in cl:
            clubs_used[c] = lab(C[c], "en")
    with open(os.path.join(ROOT, "data", "pool.json"), "w", encoding="utf-8") as f:
        json.dump({"players": out, "clubs": clubs_used, "countries": nats_used}, f, ensure_ascii=False, separators=(",", ":"))
    print("pool players", len(out), "clubs", len(clubs_used), "countries", len(nats_used),
          "size", os.path.getsize(os.path.join(ROOT, "data", "pool.json")) // 1024, "KB")


if __name__ == "__main__":
    fetch() if (sys.argv[1] if len(sys.argv) > 1 else "fetch") == "fetch" else build()
