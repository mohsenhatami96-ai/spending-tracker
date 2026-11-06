// Two-level categories: main categories, each with optional subcategories. Transactions/rules/budgets store the leaf name
// (a subcategory, or a main category for "general"). Names are unique across both levels.
export const CATEGORY_TREE = [
  ['Housing', '#5c7cfa', 'expense', ['Mortgage/Rent', 'Housing fee/BRF', 'Home insurance', 'Repairs & furnishing']],
  ['Utilities', '#7048e8', 'expense', ['Electricity', 'Broadband', 'Mobile', 'Water/heating']],
  ['Groceries', '#2f9e6b', 'expense', ['Supermarket', 'Ethnic/specialty store', 'Bakery', 'Alcohol/Systembolaget']],
  ['Dining', '#f08c00', 'expense', ['Restaurant', 'Fast food', 'Café', 'Takeaway/delivery', 'Bar']],
  ['Transport', '#1c7ed6', 'expense', ['Fuel', 'Parking', 'Public transport', 'Taxi', 'Car service/repair', 'Vehicle tax/insurance', 'Car loan/leasing']],
  ['Shopping', '#d6336c', 'expense', ['Clothing', 'Electronics', 'Home & garden', 'Online marketplace', 'Kids', 'Hobbies']],
  ['Health', '#0ca678', 'expense', ['Pharmacy', 'Doctor/care', 'Dental', 'Optician', 'Gym/sports']],
  ['Pets', '#a9774d', 'expense', ['Vet', 'Pet insurance', 'Pet supplies']],
  ['Subscriptions', '#ae3ec9', 'expense', ['Streaming', 'Software/apps', 'Memberships/unions']],
  ['Insurance', '#3b5bdb', 'expense', []],
  ['Finance', '#495057', 'expense', ['Bank fees', 'Loan/credit', 'Unemployment fund']],
  ['Entertainment', '#f76707', 'expense', []],
  ['Travel', '#1098ad', 'expense', ['Flights', 'Hotels', 'Trains']],
  ['Personal care', '#e64980', 'expense', ['Hair/barber', 'Beauty']],
  ['Education', '#74b816', 'expense', []],
  ['Gifts & donations', '#c2255c', 'expense', []],
  ['Income', '#37b24d', 'income', ['Salary', 'Refunds', 'Other income']],
  ['Transfers', '#868e96', 'transfer', ['Swish', 'Own accounts', 'Savings', 'Credit card payment']],
  ['Other', '#a0a7b4', 'expense', []]
];
// Old flat categories (v1 data, old backups, old rules) -> new names
export const LEGACY_CATS = { 'Bills & Utilities': 'Utilities' };
export function shadeColor(hex, i, n) {   // lighter/darker variants of the parent colour for subcategories
  const c = parseInt(hex.slice(1), 16), r = c >> 16, g = (c >> 8) & 255, b = c & 255, f = n <= 1 ? 0 : (i / (n - 1)) * 0.9 - 0.45;
  const mix = v => Math.round(f > 0 ? v + (255 - v) * f : v * (1 + f));
  return '#' + [mix(r), mix(g), mix(b)].map(v => v.toString(16).padStart(2, '0')).join('');
}
export const DEFAULT_CATS = CATEGORY_TREE.flatMap(([name, color, type, subs]) => [{ name, color, type }].concat(subs.map((s, i) => ({ name: s, color: shadeColor(color, i, subs.length), type, parent: name }))));
// Generic keyword rules (lowest automatic tier, below the built-in merchant dictionary). First match wins; user rules go on top.
export const DEFAULT_RULES = [
  ['Credit card payment', ['kortfaktura', 'kreditkortsfaktura', 'kreditkort', 'credit card payment', 'card payment received', 'inbetalning tack', 'betalning mottagen', 'payment thank you', 'seb kort', 'sebkort', 'eurocard', 'amex', 'american express', 'bank norwegian', 'norwegian bank', 'resurs bank', 'resurs', 'ica banken kort', 'ica banken', 'ikano bank', 'entercard', 're:member', 'remember kort', 'coop mastercard', 'mastercard faktura', 'klarna bank', 'klarna', 'collector bank', 'collector', 'qliro', 'walley', 'svea bank', 'svea ekonomi', 'avarda', 'santander kort', 'nordea kort', 'swedbank kort', 'handelsbanken kort']],
  ['Swish', ['swish', '/^\\s*\\+?46\\s?7\\d[\\d\\s-]{6,}\\s*$/', '/^\\s*07\\d[\\d\\s-]{6,}\\s*$/']],
  ['Savings', ['to savings', 'from savings', 'sparkonto', 'sparande', 'avanza', 'nordnet', 'isk', 'fondköp', 'fondkop']],
  ['Own accounts', ['internal transfer', 'egen överföring', 'eget konto', 'överföring', 'overforing', 'omföring']],
  ['Transfers', ['transfer', 'venmo', 'zelle', 'autopay', 'revolut top-up', 'atm withdrawal', 'cash withdrawal', 'bankomat', 'uttag', '/^\\s*\\+?\\d[\\d\\s-]{6,}\\s*$/']],
  ['Salary', ['salary', 'payroll', 'lön', 'lon', 'löneutbetalning', 'wages', 'paycheck', 'direct deposit']],
  ['Refunds', ['refund', 'återbetalning', 'aterbetalning', 'retur', 'reimbursement', 'tax refund', 'skatteåterbäring', 'skatteaterbaring']],
  ['Other income', ['dividend', 'utdelning', 'interest paid', 'interest earned', 'ränta', 'pension', 'försäkringskassan', 'barnbidrag', 'csn utbetalning']],
  ['Unemployment fund', ['a-kassa', 'akassa', 'a kassa', 'arbetslöshetskassa', 'arbetsloshetskassa']],
  ['Memberships/unions', ['unionen', 'fackförbund', 'fackavgift', 'medlemsavgift', 'akavia', 'sveriges ingenjörer', 'ledarna', 'transport facket', 'if metall', 'seko', 'naturskyddsföreningen']],
  ['Streaming', ['netflix', 'spotify', 'hulu', 'disney+', 'disney plus', 'hbo', 'max.com', 'youtube premium', 'amazon prime', 'prime video', 'audible', 'storytel', 'bookbeat', 'nextory', 'viaplay', 'tv4 play', 'tv4', 'cmore', 'c more', 'crunchyroll', 'paramount+', 'skyshowtime', 'apple tv', 'deezer', 'tidal', 'allente', 'boxer', 'discovery+']],
  ['Software/apps', ['apple.com/bill', 'apple com bi', 'icloud', 'google storage', 'google one', 'google play', 'adobe', 'microsoft 365', 'office 365', 'microsoft', 'dropbox', 'chatgpt', 'openai', 'patreon', 'duolingo', 'notion', 'github', '1password', 'nordvpn', 'app store', 'steam']],
  ['Mortgage/Rent', ['rent', 'hyra', 'hyresavi', 'mortgage', 'bolån', 'bolan', 'landlord', 'sbab', 'stadshypotek', 'hyresvärd']],
  ['Housing fee/BRF', ['brf', 'bostadsrättsförening', 'bostadsrattsforening', 'månadsavgift', 'manadsavgift', 'hoa']],
  ['Home insurance', ['hemförsäkring', 'hemforsakring', 'villaförsäkring', 'home insurance']],
  ['Repairs & furnishing', ['bauhaus', 'byggmax', 'hornbach', 'k-rauta', 'beijer', 'ikea', 'mio', 'jysk', 'rusta', 'hemtex', 'clas ohlson', 'jula', 'biltema', 'bygg', 'järnhandel', 'jarnhandel', 'färg', 'flyttfirma', 'städ', 'stadfirma', 'rörmokare', 'elektriker', 'snickare', 'home depot', 'lowes']],
  ['Electricity', ['electric', 'electricity', 'vattenfall', 'e.on', 'eon', 'fortum', 'ellevio', 'tibber', 'greenely', 'godel', 'bixia', 'elnät', 'elnat', 'elhandel', 'energi', 'kraft', 'el']],
  ['Broadband', ['internet', 'broadband', 'bredband', 'ownit', 'bahnhof', 'bredband2', 'com hem', 'comhem', 'stofa', 'telenor bredband', 'fiber', 'stadsnät', 'comcast', 'xfinity']],
  ['Mobile', ['telia', 'tele2', 'telenor', 'comviq', 'tre', 'hallon', 'vimla', 'fello', 'chilimobil', 'halebop', 'lyca', 'lycamobile', 'verizon', 'at&t', 't-mobile', 'phone bill', 'mobil abonnemang']],
  ['Water/heating', ['water', 'vatten', 'va-avgift', 'fjärrvärme', 'fjarrvarme', 'sophämtning', 'renhållning', 'utility', 'utilities']],
  ['Vehicle tax/insurance', ['fordonsskatt', 'transportstyrelsen', 'trängselskatt', 'trangselskatt', 'bilförsäkring', 'bilforsakring', 'trafikförsäkring', 'infrastrukturavgift']],
  ['Car loan/leasing', ['billån', 'billan', 'billeasing', 'leasing', 'privatleasing', 'volvo car financial', 'volkswagen finans', 'vw finans', 'toyota financial', 'santander consumer', 'ald automotive', 'ayvens']],
  ['Home insurance', ['hedvig']],
  ['Pet insurance', ['lassie', 'agria', 'djurförsäkring', 'sveland djur', 'petson']],
  ['Insurance', ['insurance', 'försäkring', 'forsakring', 'folksam', 'if skadeförsäkring', 'trygg-hansa', 'länsförsäkringar', 'lansforsakringar', 'gjensidige', 'moderna försäkringar', 'dina försäkringar', 'svedea', 'sveland', 'skandia', 'geico', 'state farm']],
  ['Loan/credit', ['lendo', 'avbetalning', 'privatlån', 'privatlan', 'blancolån', 'lånebetalning', 'amortering', 'lån', 'csn', 'kronofogden']],
  ['Bank fees', ['avgift kort', 'kortavgift', 'årsavgift', 'arsavgift', 'bankavgift', 'avgift', 'paketavgift', 'monthly fee', 'service fee', 'overdraft']],
  ['Takeaway/delivery', ['uber eats', 'ubereats', 'doordash', 'grubhub', 'deliveroo', 'foodora', 'wolt', 'just eat', 'hemkörning']],
  ['Fast food', ['mcdonald', 'mcdonalds', 'mcdonald\'s', 'max burgers', 'max', 'burger king', 'kfc', 'subway', 'sibylla', 'taco bell', 'five guys', 'chipotle', 'pizza hut', 'dominos', 'domino\'s', 'o\'learys', 'bastard burgers', 'burger', 'kebab', 'falafel', 'gatukök', 'grill', 'korvkiosk', 'hamburgare', 'tim hortons', 'dunkin']],
  ['Café', ['cafe', 'café', 'kafé', 'kafe', 'coffee', 'kaffe', 'starbucks', 'espresso house', 'wayne\'s coffee', 'waynes coffee', 'joe & the juice', 'pressbyrån fika', 'konditori', 'fika']],
  ['Bar', ['bar', 'pub', 'krog', 'nattklubb', 'cocktail', 'ölhall', 'bryggeri', 'vinbar', 'sportbar']],
  ['Restaurant', ['restaurant', 'restaurang', 'bistro', 'trattoria', 'osteria', 'brasserie', 'pizzeria', 'pizza', 'sushi', 'thai', 'ramen', 'indisk', 'indian', 'kinesisk', 'libanesisk', 'steakhouse', 'kitchen', 'diner', 'taverna', 'tapas', 'dumpling', 'noodle', 'wok', 'poke', 'glassbar', 'sushibar', 'lunch']],
  ['Bakery', ['bageri', 'bakery', 'bakverk', 'pâtisserie', 'patisserie', 'pret']],
  ['Alcohol/Systembolaget', ['systembolaget', 'systemet', 'vinoteket']],
  ['Supermarket', ['whole foods', 'trader joe', 'safeway', 'kroger', 'aldi', 'lidl', 'tesco', 'sainsbury', 'asda', 'waitrose', 'ica', 'coop', 'willys', 'hemköp', 'hemkop', 'city gross', 'carrefour', 'rewe', 'edeka', 'albert heijn', 'publix', 'wegmans', 'costco', 'sprouts', 'grocery', 'groceries', 'supermarket', 'instacart', 'mathem', 'maxi ica', 'ica maxi', 'ica nara', 'ica kvantum', 'tempo', 'netto', 'matsmart', 'mat.se', 'stora coop', 'handlar\'n', 'handlarn', 'snabbgross']],
  ['Ethnic/specialty store', ['livs', 'livsmedel', 'matbutik', 'mat', 'frukt', 'grönt', 'gront', 'fisk', 'chark', 'slakteri', 'ostbutik', 'delikatess', 'asian market', 'orientlivs', 'halal', 'tobak', 'kiosk', 'pressbyrån', 'pressbyran', '7-eleven', '7 eleven']],
  ['Fuel', ['shell', 'chevron', 'exxon', 'exxonmobil', 'mobil gas', 'mobil oil', 'bp', 'circle k', 'preem', 'okq8', 'st1', 'ingo', 'texaco', 'fuel', 'gas station', 'petrol', 'tanka', 'bensin', 'drivmedel', 'supercharger', 'laddning', 'laddstation', 'ionity', 'recharge']],
  ['Parking', ['parking', 'parkering', 'easypark', 'aimo park', 'aimo', 'qpark', 'q-park', 'apcoa', 'parkster', 'mobill', 'stockholm parkering', 'p-avgift', 'felparkering', 'kontrollavgift']],
  ['Taxi', ['uber', 'lyft', 'bolt', 'taxi', 'cabonline', 'taxi kurir', 'taxi stockholm', 'sverigetaxi', 'zimpler taxi']],
  ['Public transport', ['sl', 'sl access', 'storstockholms lokaltrafik', 'västtrafik', 'vasttrafik', 'skånetrafiken', 'skanetrafiken', 'upplands lokaltrafik', 'ul', 'östgötatrafiken', 'metro', 'transit', 'mta', 'tfl', 'ventra', 'clipper', 'buss', 'bus', 'tunnelbana', 'pendeltåg', 'spårvagn', 'färja', 'waxholmsbolaget', 'voi', 'lime', 'tier']],
  ['Trains', ['sj', 'vy', 'mtr express', 'snälltåget', 'snalltaget', 'öresundståg', 'train', 'tåg', 'flixtrain', 'flixbus', 'trainline']],
  ['Car service/repair', ['bilverkstad', 'verkstad', 'bilservice', 'däck', 'dack', 'däckhotell', 'bilvård', 'bilvard', 'biltvätt', 'biltvatt', 'car wash', 'bilprovning', 'besikta', 'opus bilprovning', 'mekonomen', 'meca', 'autoexperten', 'vianor', 'euromaster', 'bilia', 'toll', 'vägtull']],
  ['Flights', ['airline', 'airlines', 'air lines', 'airways', 'lufthansa', 'ryanair', 'easyjet', 'norwegian air', 'norwegian', 'sas', 'klm', 'air france', 'emirates', 'qatar airways', 'turkish airlines', 'finnair', 'wizz air', 'braathens', 'bra flyg', 'flyg', 'flygbiljett', 'arlanda express']],
  ['Hotels', ['airbnb', 'hotel', 'hotels', 'hotell', 'booking.com', 'hostel', 'vandrarhem', 'marriott', 'hilton', 'hyatt', 'scandic', 'nordic choice', 'strawberry', 'clarion', 'radisson', 'best western', 'elite hotels', 'first hotel', 'motel', 'stugby', 'camping']],
  ['Travel', ['expedia', 'trip.com', 'vrbo', 'ving', 'tui', 'apollo', 'sunweb', 'resebyrå', 'ticket resebyrå', 'hertz', 'avis', 'sixt', 'europcar', 'resa', 'travel']],
  ['Pharmacy', ['pharmacy', 'apotek', 'apoteket', 'apotek hjärtat', 'kronans apotek', 'lloyds apotek', 'apotea', 'meds', 'cvs', 'walgreens', 'rite aid']],
  ['Dental', ['dental', 'dentist', 'tandläkare', 'tandlakare', 'tandvård', 'tandvard', 'folktandvården', 'folktandvarden', 'tandhygienist']],
  ['Optician', ['optician', 'optiker', 'optik', 'synoptik', 'specsavers', 'smarteyes', 'lensway', 'linsbutiken']],
  ['Doctor/care', ['doctor', 'läkare', 'lakare', 'clinic', 'klinik', 'hospital', 'sjukhus', 'vårdcentral', 'vardcentral', 'vårdcentralen', 'region stockholm', 'patientavgift', 'kry', 'min doktor', 'doktor.se', '1177', 'capio', 'aleris', 'physio', 'fysioterapi', 'naprapat', 'kiropraktor', 'psykolog', 'therapy', 'terapi', 'massage']],
  ['Gym/sports', ['gym', 'fitness', 'sats', 'friskis', 'friskis&svettis', 'nordic wellness', 'actic', 'fitness24seven', 'fitness 24 seven', 'sporthall', 'simhall', 'badhus', 'padel', 'träning', 'traning', 'idrott', 'golf', 'klättring', 'yoga', 'crossfit', 'planet fitness']],
  ['Vet', ['veterinär', 'veterinar', 'djurklinik', 'djursjukhus', 'evidensia', 'anicura', 'firstvet', 'vet']],
  ['Pet supplies', ['zoo', 'djuraffär', 'djurbutik', 'arken zoo', 'musti', 'buddy', 'zooplus', 'bozita']],
  ['Hair/barber', ['frisör', 'frisor', 'frisörsalong', 'frisorsalong', 'barberare', 'barber', 'hårsalong', 'harsalong', 'klipp', 'salong', 'hair']],
  ['Beauty', ['skönhet', 'skonhet', 'nagelstudio', 'naglar', 'nails', 'spa', 'kosmetik', 'kicks', 'lyko', 'sephora', 'face stockholm', 'the body shop', 'rituals', 'hudvård', 'fransar', 'brows']],
  ['Education', ['skola', 'school', 'universitet', 'university', 'kurs', 'course', 'utbildning', 'studiefrämjandet', 'medborgarskolan', 'folkuniversitetet', 'körkort', 'trafikskola', 'udemy', 'coursera', 'bokus studentlitteratur', 'kursavgift']],
  ['Gifts & donations', ['gåva', 'gava', 'donation', 'insamling', 'röda korset', 'roda korset', 'unicef', 'läkare utan gränser', 'rädda barnen', 'radda barnen', 'cancerfonden', 'plan international', 'sos barnbyar', 'stadsmissionen', 'blommor', 'florist', 'interflora', 'present', 'gift']],
  ['Entertainment', ['cinema', 'movie', 'movies', 'amc', 'regal', 'sf bio', 'filmstaden', 'bio', 'theatre', 'theater', 'teater', 'playstation', 'xbox', 'nintendo', 'ticketmaster', 'live nation', 'tickster', 'concert', 'konsert', 'bowling', 'museum', 'twitch', 'eventbrite', 'escape room', 'liseberg', 'gröna lund', 'grona lund', 'skansen', 'kolmården', 'nöjespark', 'svenska spel', 'atg', 'unibet', 'bingo', 'casino']],
  ['Kids', ['babyland', 'jollyroom', 'lekia', 'br leksaker', 'toys', 'leksaker', 'polarn o. pyret', 'polarn o pyret', 'name it', 'barnkläder', 'förskola', 'fritids']],
  ['Electronics', ['elgiganten', 'mediamarkt', 'netonnet', 'power', 'webhallen', 'inet', 'komplett', 'kjell', 'kjell & company', 'dustin', 'proshop', 'apple store', 'best buy', 'teknikmagasinet', 'electronics']],
  ['Clothing', ['h&m', 'zara', 'uniqlo', 'kappahl', 'lindex', 'dressmann', 'gina tricot', 'cubus', 'mq', 'weekday', 'monki', '& other stories', 'cos', 'jack & jones', 'vero moda', 'only', 'nike', 'adidas', 'zalando', 'boozt', 'nelly', 'shein', 'primark', 'stadium', 'intersport', 'xxl', 'naturkompaniet', 'scorett', 'skopunkten', 'din sko', 'nilson', 'kläder', 'klader', 'sko', 'skor']],
  ['Online marketplace', ['amazon', 'amzn', 'ebay', 'etsy', 'temu', 'aliexpress', 'wish', 'cdon', 'tradera', 'blocket', 'vinted', 'sellpy', 'fyndiq', 'prisjakt', 'wish.com']],
  ['Hobbies', ['adlibris', 'bokus', 'akademibokhandeln', 'pocket shop', 'bokhandel', 'bok', 'panduro', 'sportfiske', 'fiske', 'hobby', 'game', 'ateljé', 'musikaffär', 'fotografiska', 'scandinavian photo', 'cyklar', 'cykel']],
  ['Home & garden', ['plantagen', 'blomsterlandet', 'granngården', 'granngarden', 'trädgård', 'tradgard', 'åhlens', 'ahlens', 'cervera', 'lagerhaus', 'designtorget', 'ikea', 'jysk', 'mio', 'rusta', 'hemtex', 'kitchentime', 'royal design', 'clas ohlson', 'jula', 'biltema', 'normal', 'dollarstore', 'lager 157', 'ö&b', 'överskottsbolaget', 'inredning']],
  ['Shopping', ['target', 'walmart', 'department store', 'varuhus', 'nk', 'gallerian']]
];
export const CURRENCIES = [['USD','US Dollar'],['EUR','Euro'],['SEK','Swedish Krona'],['GBP','British Pound'],['NOK','Norwegian Krone'],['DKK','Danish Krone'],['CHF','Swiss Franc'],['CAD','Canadian Dollar'],['AUD','Australian Dollar'],['JPY','Japanese Yen'],['INR','Indian Rupee'],['AED','UAE Dirham'],['TRY','Turkish Lira'],['IRR','Iranian Rial']];
export const PALETTE = ['#4f6bed','#e64980','#12b886','#fab005','#7950f2','#fd7e14','#15aabf','#82c91e','#be4bdb','#fa5252','#228be6','#40c057'];

