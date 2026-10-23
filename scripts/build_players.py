"""Builds data/players.json from Wikidata.

Usage:
  py scripts/build_players.py fetch   # download raw data -> scripts/raw.json
  py scripts/build_players.py build   # raw.json + appearance.txt -> data/players.json

Picks the most famous footballers worldwide (by number of Wikipedia language
editions) plus the most famous Turkish footballers. Ranking uses the SPARQL
service (rate-limited, 2 queries); everything else uses the entity API.
Appearance tags come from scripts/appearance.txt (hand-checked).
"""
import json
import os
import sys
import time
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = "FriendsGamesBuilder/1.0 (hobby project)"
RAW = os.path.join(ROOT, "scripts", "raw.json")

GLOBAL_COUNT = 450
TURKISH_COUNT = 50


def get(url):
    for attempt in range(6):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.load(r)
        except Exception as e:  # noqa: BLE001
            print("  retry", attempt, e, file=sys.stderr)
            time.sleep(65)
    raise RuntimeError("request failed: " + url[:120])


def sparql(query):
    url = "https://query.wikidata.org/sparql?" + urllib.parse.urlencode({"query": query, "format": "json"})
    return get(url)["results"]["bindings"]


def entities(ids, props):
    out = {}
    ids = list(ids)
    for i in range(0, len(ids), 50):
        part = ids[i:i + 50]
        url = "https://www.wikidata.org/w/api.php?" + urllib.parse.urlencode({
            "action": "wbgetentities", "ids": "|".join(part), "props": props,
            "languages": "en|tr", "format": "json"})
        out.update(get(url).get("entities", {}))
        time.sleep(0.3)
    return out


def top_players():
    q = """SELECT ?p ?links WHERE {
      ?p wdt:P106 wd:Q937857; wdt:P31 wd:Q5; wikibase:sitelinks ?links. FILTER(?links > 45)
    } ORDER BY DESC(?links) LIMIT %d""" % (GLOBAL_COUNT + 200)
    glob = [b["p"]["value"].rsplit("/", 1)[-1] for b in sparql(q)]
    time.sleep(65)
    q = """SELECT ?p ?links WHERE {
      ?p wdt:P106 wd:Q937857; wdt:P31 wd:Q5; wdt:P1532 wd:Q43; wikibase:sitelinks ?links. FILTER(?links > 10)
    } ORDER BY DESC(?links) LIMIT %d""" % (TURKISH_COUNT + 80)
    tur = [b["p"]["value"].rsplit("/", 1)[-1] for b in sparql(q)]
    return glob, tur


def claim_ids(ent, prop):
    res = []
    for c in ent.get("claims", {}).get(prop, []):
        dv = c["mainsnak"].get("datavalue")
        if dv and isinstance(dv["value"], dict) and "id" in dv["value"]:
            res.append(dv["value"]["id"])
    return res


def fetch():
    glob, tur = top_players()
    print("global", len(glob), "turkish", len(tur))
    ids = list(dict.fromkeys(glob + tur))
    players = entities(ids, "labels|claims|sitelinks")
    club_ids, misc = set(), set()
    for e in players.values():
        club_ids.update(claim_ids(e, "P54"))
        for p in ("P413", "P1532", "P27"):
            misc.update(claim_ids(e, p))
    print("clubs", len(club_ids))
    clubs = entities(club_ids, "labels|claims")
    for e in clubs.values():
        misc.update(claim_ids(e, "P118"))
    labels = entities(misc, "labels|claims")
    # Keep only what we need to keep raw.json small.
    slim = lambda d, props: {k: {"labels": v.get("labels", {}), "claims": {p: v.get("claims", {}).get(p, []) for p in props},
                                 "sitelinks": len(v.get("sitelinks", {}))} for k, v in d.items()}
    raw = {"glob": glob, "tur": tur,
           "players": slim(players, ["P569", "P570", "P2048", "P18", "P21", "P413", "P1532", "P27", "P166", "P54"]),
           "clubs": slim(clubs, ["P118", "P31"]),
           "labels": slim(labels, ["P30"])}
    with open(RAW, "w", encoding="utf-8") as f:
        json.dump(raw, f, ensure_ascii=False)
    print("saved", RAW)


if __name__ == "__main__":
    if (sys.argv[1] if len(sys.argv) > 1 else "fetch") == "fetch":
        fetch()


POS_MAP = {"goalkeeper": "GK", "defender": "DF", "back": "DF", "sweeper": "DF", "libero": "DF",
           "midfielder": "MF", "playmaker": "MF", "forward": "FW", "striker": "FW", "winger": "FW",
           "centre-forward": "FW", "attacker": "FW", "inside forward": "FW", "outside forward": "FW"}
CONT = {"Q46": "EU", "Q18": "SA", "Q15": "AF", "Q49": "NA", "Q48": "AS", "Q538": "OC", "Q55643": "OC"}
NATIONAL_TEAM_TYPES = {"Q6979593", "Q1194951", "Q2412834", "Q23847779", "Q20639856", "Q20639847"}


def lab(d, lang):
    return d.get("labels", {}).get(lang, {}).get("value")


def snak_vals(ent, prop):
    return [c["mainsnak"].get("datavalue", {}).get("value") for c in ent["claims"].get(prop, [])
            if c["mainsnak"].get("datavalue") and c.get("rank") != "deprecated"]


def ids_of(ent, prop):
    return [v["id"] for v in snak_vals(ent, prop) if isinstance(v, dict) and "id" in v]


def year(v):
    try:
        return int(v["time"][1:5])
    except Exception:  # noqa: BLE001
        return None


# Non-footballers, people famous mainly as coaches/officials, and very obscure entries.
EXCLUDE = set("""Q34670 Q7085 Q4573 Q57641 Q18391 Q169963 Q52395487 Q122003 Q179908 Q108153171 Q124138
Q57775 Q152274 Q213504 Q44473 Q202693 Q165772 Q151025 Q271464 Q44980 Q79983 Q4462 Q83106 Q207431
Q484534 Q43304 Q191634 Q235068 Q207457 Q189587 Q144048 Q2428403 Q152107 Q657360 Q380695 Q558820
Q15401668 Q331968 Q310598 Q367474 Q733494 Q195620 Q61886 Q310607 Q2011456 Q214859 Q76679 Q222924 Q310602 Q311209 Q331957 Q5530861""".split())
NAME_FIX = {"Q108159340": "Arda Güler", "Q38136": "Marcelo", "Q168740": "Juan Mata",
            "Q186330": "Rafael Márquez", "Q46741": "Leonardo", "Q222151": "João Moutinho", "Q11557367": "Takuma Asano", "Q22082505": "Marc Cucurella"}
LEAGUE_FIX = {"Q15804": ("Serie A", "Serie A"), "Q82595": ("Bundesliga", "Bundesliga"),
              "Q206073": ("Ukrainian Premier League", "Ukrayna Premier Ligi"),
              "Q255633": ("Saudi Pro League", "Suudi Arabistan Pro Ligi"), "Q60681": ("Qatar Stars League", "Katar Yıldızlar Ligi"),
              "Q182165": ("Russian Premier League", "Rusya Premier Ligi"), "Q206813": ("Brazilian Série A", "Brezilya Série A"),
              "Q223170": ("Argentine Primera División", "Arjantin Primera División"), "Q276445": ("J1 League", "Japonya J1 Ligi"),
              "Q19510": ("EFL Championship", "İngiltere Championship"), "Q209318": ("Chinese Super League", "Çin Süper Ligi"),
              "Q14377162": ("Scottish Premiership", "İskoçya Premiership"), "Q764690": ("Liga MX", "Meksika Liga MX"),
              "Q18543": ("Major League Soccer (MLS)", "ABD MLS"), "Q216022": ("Belgian Pro League", "Belçika Pro Ligi")}
NAT_FIX = {"Q294806": "Q29", "Q4457": "Q183", "Q44458": "Q183", "Q152871": "Q183", "Q159045": "Q183",
           "Q44464": "Q183", "Q57079": "Q183", "Q43744": "Q183", "Q163564": "Q403", "Q181921": "Q403",
           "Q189217": "Q224", "Q171295": "Q213", "Q22007007": "Q43", "Q315309": "Q43", "Q279436": "Q43",
           "Q3191617": "Q43", "Q115453": "Q224", "Q327456": "Q1028", "Q191885": "Q38", "Q459707": "Q29",
           "Q151034": "Q117", "Q30007142": "Q21", "Q7085": "Q35"}


# Leagues that questions are asked about (top divisions people know).
QUESTION_LEAGUES = ["Q9448", "Q324867", "Q15804", "Q82595", "Q13394", "Q485568", "Q167541", "Q182994", "Q18543",
                    "Q206813", "Q223170", "Q255633", "Q182165", "Q216022", "Q14377162", "Q764690", "Q209318",
                    "Q60681", "Q235114", "Q276445", "Q19510"]
# Clubs whose Wikidata league list misses top-flight seasons (club name substring -> league).
FORMER_TOP_FLIGHT = {
    "Q9448": ["Blackburn Rovers", "Sunderland", "Middlesbrough", "Derby County", "Bolton Wanderers", "Wigan",
              "Portsmouth", "Birmingham City", "Queens Park Rangers", "Stoke City", "Swansea", "Norwich",
              "Watford", "West Bromwich", "Charlton", "Reading F", "Hull City", "Blackpool", "Sheffield",
              "Coventry", "Ipswich", "Burnley", "Cardiff", "Huddersfield", "Leeds United", "Leicester",
              "Southampton", "Fulham", "Aston Villa", "Newcastle", "West Ham", "Everton", "Wolverhampton"],
    "Q15804": ["Sampdoria", "Palermo", "Bari", "Brescia", "Chievo", "Siena", "Reggina", "Parma", "Torino",
               "Genoa", "Udinese", "Bologna", "Fiorentina", "Lazio", "Roma", "Napoli", "Atalanta", "Cagliari"],
    "Q324867": ["Deportivo de La Coruña", "Málaga", "Zaragoza", "Racing de Santander", "Sporting de Gijón",
                "Valencia", "Sevilla", "Villarreal", "Real Betis", "Espanyol", "Athletic"],
    "Q82595": ["Schalke", "Hamburger", "Kaiserslautern", "Hertha", "Köln", "Nürnberg", "Werder", "Wolfsburg",
               "Leverkusen", "Stuttgart", "Hannover", "Hoffenheim", "Mönchengladbach", "Dortmund"],
    "Q13394": ["Bordeaux", "Saint-Étienne", "Sochaux", "Lyon", "Marseille", "Monaco", "Lille", "Nantes",
               "Auxerre", "Lens"],
    "Q485568": ["Galatasaray", "Fenerbahçe", "Beşiktaş", "Trabzonspor", "Bursaspor", "Başakşehir",
                "Gençlerbirliği", "Ankaragücü", "Denizlispor", "Manisaspor", "Kocaelispor", "Sivasspor",
                "Kayserispor", "Antalyaspor", "Konyaspor", "Gaziantepspor", "Eskişehirspor"],
}


def by_rank(ent, prop):
    cs = [c for c in ent["claims"].get(prop, []) if c["mainsnak"].get("datavalue") and c.get("rank") != "deprecated"]
    cs.sort(key=lambda c: c.get("rank") != "preferred")
    return [c["mainsnak"]["datavalue"]["value"]["id"] for c in cs]


def load_appearance():
    path = os.path.join(ROOT, "scripts", "appearance.txt")
    out = {}
    if os.path.exists(path):
        for line in open(path, encoding="utf-8"):
            line = line.split("#")[0].strip()
            if line:
                parts = line.split("|")
                out[parts[0]] = parts[1:]
    return out


def build(list_only=False):
    raw = json.load(open(RAW, encoding="utf-8"))
    P, C, L = raw["players"], raw["clubs"], raw["labels"]
    app = load_appearance()

    def convert(pid):
        e = P.get(pid)
        if not e or pid in EXCLUDE or "Q6581097" not in ids_of(e, "P21"):
            return None
        imgs = snak_vals(e, "P18")
        if not imgs:
            return None
        born = next((year(v) for v in snak_vals(e, "P569") if year(v)), None)
        if not born:
            return None
        died = next((year(v) for v in snak_vals(e, "P570") if year(v)), None)
        h = None
        for v in snak_vals(e, "P2048"):
            amt = float(v["amount"])
            unit = v.get("unit", "")
            if unit.endswith("Q11573"):
                amt *= 100
            if 150 <= amt <= 215:
                h = round(amt)
                break
        pos = []
        for q in ids_of(e, "P413"):
            name = (lab(L.get(q, {}), "en") or "").lower()
            for k, code in POS_MAP.items():
                if k in name and code not in pos:
                    pos.append(code)
        nat = NAT_FIX.get(pid) or next((n for n in by_rank(e, "P1532") + by_rank(e, "P27") if ids_of(L.get(n, {"claims": {}}), "P30")), None)
        if not nat:
            return None
        clubs, leagues, active = [], [], False
        for c in e["claims"].get("P54", []):
            dv = c["mainsnak"].get("datavalue")
            if not dv:
                continue
            cid = dv["value"]["id"]
            ce = C.get(cid)
            if not ce:
                continue
            cname = lab(ce, "en")
            if not cname or "national" in cname.lower() or " U-" in cname or " U2" in cname or " U1" in cname:
                continue
            if cname.endswith((" B", " C", " Atlètic", " Castilla", " U19", " U21", " U23")) or " II" in cname or "Reserves" in cname or "Youth" in cname or "Primavera" in cname:
                continue
            if "P582" not in c.get("qualifiers", {}):
                active = True
            if cid not in [x[0] for x in clubs]:
                clubs.append((cid, cname))
            club_leagues = ids_of(ce, "P118") + [lg for lg, names in FORMER_TOP_FLIGHT.items()
                                                 if any(n in cname for n in names)]
            for lg in club_leagues:
                if lg in QUESTION_LEAGUES and lg not in leagues:
                    leagues.append(lg)
        if died or born < 1982:
            active = False
        nl = L.get(nat, {})
        conts = [CONT[x] for x in ids_of(nl, "P30") if x in CONT] if nl else []
        cont = "EU" if "EU" in conts else (conts[0] if conts else None)
        a = app.get(pid)
        return {
            "id": pid,
            "name": NAME_FIX.get(pid) or lab(e, "en") or lab(e, "tr"),
            "img": imgs[0],
            "born": born,
            "dead": bool(died),
            "active": active,
            "height": h,
            "pos": pos,
            "nat": nat,
            "cont": cont,
            "clubs": [x[0] for x in clubs],
            "leagues": leagues,
            "ballon": any(v.get("id") == "Q166177" for v in snak_vals(e, "P166") if isinstance(v, dict)),
            "app": a,
            "links": e["sitelinks"],
        }

    chosen = []
    for pid in raw["glob"]:
        p = convert(pid)
        if p and p["name"] and len(chosen) < GLOBAL_COUNT:
            chosen.append(p)
    have = {p["id"] for p in chosen}
    tur_added = 0
    for pid in raw["tur"]:
        if pid in have or tur_added >= TURKISH_COUNT:
            continue
        p = convert(pid)
        if p:
            chosen.append(p)
            tur_added += 1
    if list_only:
        for p in chosen:
            print("%s|%s|%s|%s" % (p["id"], p["name"], lab(L.get(p["nat"], {}), "en"), p["born"]))
        return
    # Dictionaries for countries, clubs and leagues actually used.
    dict_ = {"countries": {}, "clubs": {}, "leagues": {}}
    for p in chosen:
        n = L.get(p["nat"], {})
        dict_["countries"][p["nat"]] = {"en": lab(n, "en"), "tr": lab(n, "tr") or lab(n, "en"), "cont": p["cont"]}
        for c in p["clubs"]:
            dict_["clubs"][c] = lab(C[c], "en")
        for lg in p["leagues"]:
            en, tr = LEAGUE_FIX.get(lg) or (lab(L.get(lg, {}), "en"), lab(L.get(lg, {}), "tr") or lab(L.get(lg, {}), "en"))
            dict_["leagues"][lg] = {"en": en, "tr": tr}
    out_players = []
    for p in chosen:
        a = p.pop("app") or []
        p.pop("links")
        hair, beard, skin, wc, pos = (a + ["", "", "", "", ""])[:5]
        if pos and not p["pos"]:
            p["pos"] = [pos]
        p.update({"hair": hair or None, "beard": beard == "1", "skin": skin or None, "wc": wc == "1"})
        out_players.append(p)
    os.makedirs(os.path.join(ROOT, "data"), exist_ok=True)
    with open(os.path.join(ROOT, "data", "players.json"), "w", encoding="utf-8") as f:
        json.dump({"players": out_players, **dict_}, f, ensure_ascii=False, separators=(",", ":"))
    missing = [p["name"] for p in out_players if not p["hair"]]
    print("players", len(out_players), "turkish added", tur_added, "missing appearance", len(missing))
    print("leagues", len(dict_["leagues"]), "countries", len(dict_["countries"]), "clubs", len(dict_["clubs"]))


if __name__ == "__main__" and len(sys.argv) > 1 and sys.argv[1] in ("build", "list"):
    build(list_only=sys.argv[1] == "list")
