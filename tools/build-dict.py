#!/usr/bin/env python3
"""Builds the offline Swedish merchant dictionary embedded in spending-tracker.html (between @dict-begin/@dict-end).
Sources (public): name-suggestion-index (OpenStreetMap brands, dist/nsi.min.json), Wikidata (Swedish businesses,
restaurants, cafés, hotels, chains, airlines, rail operators, amusement parks, zoos, ski resorts; CC0), plus the
hand-compiled list in curated_se.py. Run:  python3 tools/build-dict.py [/tmp/dict]  (source snapshots dir)."""
import json, re, sys, os, unicodedata, csv, collections
SRC = sys.argv[1] if len(sys.argv) > 1 else '/tmp/dict'
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from curated_se import CURATED

def norm(name):
    """lowercase, keep å/ä/ö, strip other accents, punctuation -> space, drop legal suffixes / bracketed parts"""
    s = re.sub(r'\(.*?\)', ' ', str(name)).lower()
    s = ''.join(ch if ch in 'åäö' else unicodedata.normalize('NFKD', ch) for ch in s)
    s = ''.join(ch for ch in s if not unicodedata.combining(ch))
    s = s.replace('’', "'").replace("'", '')
    s = re.sub(r'[^a-z0-9åäö&]+', ' ', s).strip()
    toks = s.split()
    while toks and toks[-1] in ('ab', 'aktiebolag', 'publ', 'hb', 'kb', 'oy', 'as', 'asa', 'a s', 'ltd', 'inc', 'gmbh', 'sverige', 'sweden', 'group', 'koncernen', 'i'):
        toks.pop()
    if toks and toks[0] == 'the' and len(toks) > 1: toks = toks[1:]
    return ' '.join(toks)
fold = lambda s: s.translate(str.maketrans('åäö', 'aao'))
joined = lambda s: re.sub(r'[^a-z0-9&]', '', fold(s))

# Stoplist: Swedish place names and generic words (a merchant name equal to one of these is too ambiguous)
# never ship names that touch the user's personal places/merchants (same terms as build-pwa.js DENY)
PERSONAL = re.compile(r'roji|bil ?trean|norrt|haidari|knuten|saigon|bj.?llra|robo vac|roden|kundreskontr|solna|åkersberga|akersberga', re.I)
places = set()
try:
    for row in csv.DictReader(open(os.path.join(SRC, 'places.csv'))):
        l = norm(re.sub(r's? kommun$', '', row['l'])); places.add(l)
except FileNotFoundError: pass
GENERIC = set('''hotel hotell hotellet restaurang restaurant café cafe kafé bar pub grill pizzeria pizza sushi kebab bistro krog kök kitchen
bageri konditori butik shop store market marknad center centrum city central station gamla nya lilla stora norra södra östra västra villa
gården garden house hus park parken torget torg hamn hamnen strand slott slottet kungen kronan royal grand plaza star stjärnan
sport fitness gym bio teater museum museet galleri konsthall zoo djurpark camping vandrarhem stugby service bil taxi parkering
apotek optik frisör salong bank sparbank kassa a kassa kiosk livs mat food coffee kaffe club klubb lounge inn motel hostel
nord syd öst väst sverige svensk svenska norden nordic scandinavia scandinavian europa international design studio
first best one 1 2 3 the and och i på'''.split())

ENTRIES = {}   # key -> (leaf, source, priority)
stats = collections.Counter(); conflicts = []
def add(name, leaf, source, prio):
    k = norm(name)
    if not k or '|' in k or len(k) > 40: return
    j = joined(k)
    if len(j) < 2 or j.isdigit(): return
    if source != 'curated':
        if PERSONAL.search(k): stats['skipped_personal'] = stats.get('skipped_personal', 0) + 1; return
        if len(j) < 4 or k in GENERIC or k in places or fold(k) in places: stats['skipped_stop_' + source] += 1; return
        if len(k.split()) == 1 and len(j) < 5: stats['skipped_short_' + source] += 1; return
    old = ENTRIES.get(k)
    if old:
        if old[2] <= prio:
            if old[0] != leaf and old[2] == prio: conflicts.append((k, old[0], leaf, source))
            return
    ENTRIES[k] = (leaf, source, prio)

for leaf, names in CURATED.items():
    for n in names: add(n, leaf, 'curated', 0)

# --- name-suggestion-index (OSM brands): Swedish, Nordic/European or worldwide brands
NSI_MAP = {
 'shop/supermarket': 'Supermarket', 'shop/convenience': 'Ethnic/specialty store', 'shop/greengrocer': 'Ethnic/specialty store', 'shop/butcher': 'Ethnic/specialty store',
 'shop/seafood': 'Ethnic/specialty store', 'shop/deli': 'Ethnic/specialty store', 'shop/cheese': 'Ethnic/specialty store', 'shop/health_food': 'Ethnic/specialty store',
 'shop/frozen_food': 'Ethnic/specialty store', 'shop/spices': 'Ethnic/specialty store', 'shop/tea': 'Ethnic/specialty store', 'shop/coffee': 'Ethnic/specialty store',
 'shop/confectionery': 'Ethnic/specialty store', 'shop/chocolate': 'Ethnic/specialty store', 'shop/pastry': 'Bakery', 'shop/bakery': 'Bakery', 'shop/tobacco': 'Ethnic/specialty store',
 'shop/e-cigarette': 'Ethnic/specialty store', 'shop/newsagent': 'Ethnic/specialty store', 'shop/kiosk': 'Ethnic/specialty store', 'shop/nutrition_supplements': 'Ethnic/specialty store',
 'shop/alcohol': 'Alcohol/Systembolaget', 'shop/wine': 'Alcohol/Systembolaget', 'shop/beverages': 'Alcohol/Systembolaget',
 'amenity/restaurant': 'Restaurant', 'amenity/fast_food': 'Fast food', 'amenity/cafe': 'Café', 'amenity/ice_cream': 'Café', 'amenity/bar': 'Bar', 'amenity/pub': 'Bar', 'amenity/nightclub': 'Bar', 'amenity/biergarten': 'Bar',
 'amenity/fuel': 'Fuel', 'amenity/charging_station': 'Fuel', 'man_made/charge_point': 'Fuel', 'shop/gas': 'Fuel', 'amenity/parking': 'Parking', 'amenity/parking_entrance': 'Parking',
 'amenity/car_wash': 'Car service/repair', 'shop/car_repair': 'Car service/repair', 'shop/tyres': 'Car service/repair', 'shop/car_parts': 'Car service/repair', 'shop/motorcycle_repair': 'Car service/repair',
 'shop/car': 'Transport', 'shop/motorcycle': 'Transport', 'amenity/car_rental': 'Travel', 'amenity/bicycle_rental': 'Public transport', 'amenity/taxi': 'Taxi',
 'tourism/hotel': 'Hotels', 'tourism/motel': 'Hotels', 'tourism/guest_house': 'Hotels', 'tourism/hostel': 'Hotels', 'tourism/apartment': 'Hotels', 'tourism/camp_site': 'Hotels', 'shop/travel_agency': 'Travel',
 'amenity/pharmacy': 'Pharmacy', 'shop/chemist': 'Beauty', 'shop/optician': 'Optician', 'shop/hearing_aids': 'Doctor/care', 'amenity/dentist': 'Dental', 'amenity/doctors': 'Doctor/care', 'amenity/clinic': 'Doctor/care',
 'amenity/veterinary': 'Vet', 'shop/pet': 'Pet supplies', 'leisure/fitness_centre': 'Gym/sports', 'leisure/sports_centre': 'Gym/sports',
 'shop/hairdresser': 'Hair/barber', 'shop/beauty': 'Beauty', 'shop/cosmetics': 'Beauty', 'shop/perfumery': 'Beauty', 'shop/massage': 'Beauty',
 'shop/clothes': 'Clothing', 'shop/shoes': 'Clothing', 'shop/bag': 'Clothing', 'shop/fashion_accessories': 'Clothing', 'shop/jewelry': 'Clothing', 'shop/watches': 'Clothing', 'shop/boutique': 'Clothing', 'shop/sports': 'Clothing', 'shop/outdoor': 'Clothing',
 'shop/electronics': 'Electronics', 'shop/mobile_phone': 'Electronics', 'shop/computer': 'Electronics', 'shop/hifi': 'Electronics', 'shop/video_games': 'Electronics', 'shop/camera': 'Electronics', 'shop/appliance': 'Electronics', 'shop/printer_ink': 'Electronics',
 'shop/furniture': 'Repairs & furnishing', 'shop/doityourself': 'Repairs & furnishing', 'shop/hardware': 'Repairs & furnishing', 'shop/paint': 'Repairs & furnishing', 'shop/bed': 'Repairs & furnishing', 'shop/kitchen': 'Repairs & furnishing',
 'shop/bathroom_furnishing': 'Repairs & furnishing', 'shop/flooring': 'Repairs & furnishing', 'shop/tiles': 'Repairs & furnishing', 'shop/trade': 'Repairs & furnishing', 'shop/tool_hire': 'Repairs & furnishing',
 'shop/garden_centre': 'Home & garden', 'shop/florist': 'Home & garden', 'shop/houseware': 'Home & garden', 'shop/interior_decoration': 'Home & garden', 'shop/variety_store': 'Home & garden', 'shop/lighting': 'Home & garden', 'shop/curtain': 'Home & garden',
 'shop/department_store': 'Shopping', 'shop/general': 'Shopping', 'shop/second_hand': 'Shopping', 'shop/charity': 'Shopping', 'shop/gift': 'Shopping',
 'shop/toys': 'Kids', 'shop/baby_goods': 'Kids', 'shop/books': 'Hobbies', 'shop/stationery': 'Hobbies', 'shop/craft': 'Hobbies', 'shop/art': 'Hobbies', 'shop/music': 'Hobbies', 'shop/musical_instrument': 'Hobbies',
 'shop/bicycle': 'Hobbies', 'shop/fishing': 'Hobbies', 'shop/hunting': 'Hobbies', 'shop/games': 'Hobbies', 'shop/model': 'Hobbies', 'shop/photo': 'Hobbies', 'shop/fabric': 'Hobbies',
 'shop/telecommunication': 'Mobile', 'office/insurance': 'Insurance', 'amenity/bank': 'Finance', 'amenity/money_transfer': 'Bank fees', 'amenity/bureau_de_change': 'Bank fees',
 'amenity/cinema': 'Entertainment', 'amenity/theatre': 'Entertainment', 'leisure/bowling_alley': 'Entertainment', 'leisure/amusement_arcade': 'Entertainment', 'leisure/escape_game': 'Entertainment',
 'leisure/water_park': 'Entertainment', 'leisure/trampoline_park': 'Entertainment', 'leisure/indoor_play': 'Entertainment', 'tourism/theme_park': 'Entertainment', 'tourism/zoo': 'Entertainment', 'tourism/aquarium': 'Entertainment',
 'shop/lottery': 'Entertainment', 'shop/ticket': 'Entertainment', 'shop/laundry': 'Personal care', 'shop/dry_cleaning': 'Personal care', 'amenity/driving_school': 'Education', 'amenity/language_school': 'Education', 'amenity/music_school': 'Education',
}
REGIONS = {'se', '001', '150', '154', 'eu'}
nsi = json.load(open(os.path.join(SRC, 'nsi.json')))['nsi']
nsi_raw = []
for path, v in nsi.items():
    if not path.startswith('brands/'): continue
    leaf = NSI_MAP.get(path[7:])
    if not leaf: continue
    for it in v.get('items', []):
        ls = it.get('locationSet', {})
        inc = {x for x in ls.get('include', []) if isinstance(x, str)}; exc = {x for x in ls.get('exclude', []) if isinstance(x, str)}
        if not (inc & REGIONS) or 'se' in exc: continue
        tags = it.get('tags', {}); names = {tags.get('brand'), tags.get('name'), it.get('displayName')} | set(it.get('matchNames', []))
        prio = 1 if 'se' in inc else 2
        for n in names:
            if n and re.search(r'[a-zA-ZåäöÅÄÖ]', n) and all(ord(c) < 0x250 or c in '’' for c in n):
                add(n, leaf, 'nsi', prio); nsi_raw.append((n, leaf))

# --- Wikidata: places/chains by class (wd2.json) and Swedish businesses by type/industry (wd1.json)
WD_CLASS = {'Q11707': 'Restaurant', 'Q30022': 'Café', 'Q27686': 'Hotels', 'Q1631129': 'Hotels', 'Q507619': 'Shopping', 'Q18043413': 'Supermarket', 'Q180846': 'Supermarket',
            'Q194195': 'Entertainment', 'Q43501': 'Entertainment', 'Q130003': 'Travel', 'Q46970': 'Flights', 'Q17377208': 'Trains'}
wd_raw = []
try:
    wd2 = json.load(open(os.path.join(SRC, 'wd2.json')))
    for q, x in wd2.items():
        leaf = next((WD_CLASS[r] for r in x['roots'] if r in WD_CLASS), None)
        if not leaf: continue
        for n in {x.get('sv'), x.get('en')}:
            if n and not re.match(r'^Q\d+$', n): add(n, leaf, 'wikidata', 3); wd_raw.append((n, leaf))
except FileNotFoundError: pass
WD_TYPE = {'hotel': 'Hotels', 'inn': 'Hotels', 'gästgiveri': 'Hotels', 'hostel': 'Hotels', 'mountain hut': 'Hotels', 'mountain lodge': 'Hotels', 'hotel chain': 'Hotels',
           'restaurant': 'Restaurant', 'restaurant chain': 'Restaurant', 'fast food restaurant chain': 'Fast food', 'café': 'Café', 'bakery': 'Bakery', 'confectionery': 'Bakery',
           'pub': 'Bar', 'nightclub': 'Bar', 'jazz club': 'Entertainment', 'cinema chain': 'Entertainment', 'multiplex': 'Entertainment', 'amusement park': 'Entertainment', 'water park': 'Entertainment',
           'bank': 'Finance', 'savings bank': 'Finance', 'credit market company': 'Loan/credit', 'insurance company': 'Insurance', 'airline': 'Flights', 'railway company': 'Trains',
           'bus company': 'Public transport', 'retail chain': 'Shopping', 'bookstore': 'Hobbies', 'supermarket chain': 'Supermarket', 'fitness centre': 'Gym/sports'}
WD_IND = {'retail': 'Shopping', 'e-commerce': 'Online marketplace', 'telecommunications industry': 'Mobile', 'telecommunications': 'Mobile', 'mobile phone industry': 'Mobile', 'internet service provider': 'Broadband',
          'energy supply': 'Electricity', 'electric power industry': 'Electricity', 'energy industry': 'Electricity', 'energy and water industries': 'Electricity', 'district heating': 'Water/heating',
          'insurance': 'Insurance', 'fitness industry': 'Gym/sports', 'restaurant': 'Restaurant', 'quick service restaurant sector': 'Fast food', 'food retail sector': 'Supermarket', 'grocery store': 'Supermarket',
          'hotel chain': 'Hotels', 'tourism': 'Travel', 'streaming media': 'Streaming', 'subscription television': 'Streaming', 'gambling': 'Entertainment', 'online gambling': 'Entertainment', 'gambling industry': 'Entertainment',
          'clothing industry': 'Clothing', 'fashion': 'Clothing', 'cosmetics industry': 'Beauty', 'public transport': 'Public transport', 'rail transport': 'Trains', 'railway': 'Trains', 'aviation': 'Flights', 'air transport': 'Flights',
          'toll collection': 'Vehicle tax/insurance', 'health care': 'Doctor/care', 'health care industry': 'Doctor/care', 'economics of banking': 'Finance', 'bakery': 'Bakery', 'collection agency': 'Loan/credit'}
try:
    for x in json.load(open(os.path.join(SRC, 'wd1.json')))['results']['bindings']:
        types = [t for t in x.get('types', {}).get('value', '').split('|') if t]; inds = [t for t in x.get('inds', {}).get('value', '').split('|') if t]
        leaf = next((WD_TYPE[t] for t in types if t in WD_TYPE), None) or next((WD_IND[i] for i in inds if i in WD_IND), None)
        if leaf: add(x['label']['value'], leaf, 'wikidata', 3); wd_raw.append((x['label']['value'], leaf))
except FileNotFoundError: pass

# --- encode: per category, sorted keys, front-coded ("<prefix-len char><suffix>" joined by "|")
cats = sorted({v[0] for v in ENTRIES.values()})
DIG = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
data = []
for c in cats:
    keys = sorted(k for k, v in ENTRIES.items() if v[0] == c); out = []; prev = ''
    for k in keys:
        n = 0
        while n < min(len(prev), len(k), 35) and prev[n] == k[n]: n += 1
        out.append(DIG[n] + k[n:]); prev = k
    data.append('|'.join(out))
by_src = collections.Counter(v[1] for v in ENTRIES.values())
block = ('/* @dict-begin: built-in offline merchant dictionary, generated by tools/build-dict.py. Sources: OpenStreetMap name-suggestion-index (ODbL brand data), Wikidata (CC0), hand-compiled list of Swedish chains. */\n'
         f'const DICT_INFO = {json.dumps({"entries": len(ENTRIES), "sources": dict(by_src), "built": "2026-10-04"})};\n'
         f'const DICT_CATS = {json.dumps(cats, ensure_ascii=False)};\n'
         f'const DICT_DATA = {json.dumps(data, ensure_ascii=False)};\n'
         '/* @dict-end */\n')
html_p = os.path.join(ROOT, 'spending-tracker.html'); html = open(html_p, encoding='utf-8').read()
m = re.search(r'/\* @dict-begin[\s\S]*?/\* @dict-end \*/\n', html)
if not m: raise SystemExit('dict markers not found')
html = html[:m.start()] + block + html[m.end():]
open(html_p, 'w', encoding='utf-8').write(html)
json.dump({'curated': CURATED, 'nsi': sorted(set(nsi_raw)), 'wikidata': sorted(set(wd_raw))}, open(os.path.join(HERE, 'dict-sources.json'), 'w'), ensure_ascii=False)
print('entries', len(ENTRIES), dict(by_src), 'block bytes', len(block.encode('utf-8')), 'cats', len(cats))
print('per category', collections.Counter(v[0] for v in ENTRIES.values()).most_common())
print('skipped', dict(stats)); print('conflicts (kept first)', len(conflicts), conflicts[:15])
