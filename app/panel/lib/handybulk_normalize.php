<?php

declare(strict_types=1);

/**
 * HandyBulk normalization dictionaries — pure functions (no DB), tested by bin/handybulk-tests.php.
 * Region codes are the Knowledge Base's trading-area abbreviations (chartering/regions.js): ECSA, USG, Cont, FEAST, …;
 * countries and other places keep a canonical English name ("Philippinnes" → "Philippines").
 * Names the dictionary does not know come back unmapped; users map them in Data Sources → Review (ch_region_aliases).
 */

/** Lower-case name / abbreviation → code (the KB abbreviation where there is one). */
const HB_REGION_ALIASES = [
    'continent' => 'Cont', 'cont' => 'Cont', 'cont.' => 'Cont', 'nw europe' => 'Cont', 'north west europe' => 'Cont',
    'uk continent' => 'UKC', 'uk-continent' => 'UKC', 'ukc' => 'UKC', 'united kingdom continent' => 'UKC',
    'arag' => 'ARAG', 'amsterdam rotterdam antwerp ghent' => 'ARAG', 'skaw-passero' => 'Skaw-Passero', 'skaw passero' => 'Skaw-Passero',
    'east coast south america' => 'ECSA', 'ecsa' => 'ECSA', 'north coast south america' => 'NCSA', 'ncsa' => 'NCSA',
    'west coast south america' => 'WCSA', 'wcsa' => 'WCSA', 'east coast north america' => 'ECNA', 'ecna' => 'ECNA',
    'us gulf' => 'USG', 'u.s. gulf' => 'USG', 'usg' => 'USG', 'u.s gulf' => 'USG', 'us gulf of mexico' => 'USG',
    'us east coast' => 'USEC', 'usec' => 'USEC', 'us west coast' => 'USWC', 'uswc' => 'USWC', 'us pacific northwest' => 'PNW', 'pnw' => 'PNW',
    'north pacific' => 'NOPAC', 'nopac' => 'NOPAC', 'south east asia' => 'SEA', 'southeast asia' => 'SEA', 'south-east asia' => 'SEA', 'sea' => 'SEA', 'se asia' => 'SEA',
    'west africa' => 'WAFR', 'wafr' => 'WAFR', 'waf' => 'WAFR', 'south africa' => 'SAF', 'saf' => 'SAF', 'safr' => 'SAF',
    'east africa' => 'EAFR', 'eafr' => 'EAFR', 'east coast india' => 'ECI', 'eci' => 'ECI', 'west coast india' => 'WCI', 'wci' => 'WCI',
    'east mediterranean' => 'EMED', 'eastern mediterranean' => 'EMED', 'emed' => 'EMED', 'west mediterranean' => 'WMED', 'western mediterranean' => 'WMED', 'wmed' => 'WMED',
    'mediterranean' => 'Med', 'med' => 'Med', 'far east' => 'FEAST', 'feast' => 'FEAST', 'fe' => 'FEAST',
    'persian gulf' => 'PG', 'arabian gulf' => 'PG', 'pg' => 'PG', 'ag' => 'PG', 'red sea' => 'RSea', 'rsea' => 'RSea',
    'east coast australia' => 'ECAus', 'ecaus' => 'ECAus', 'west coast australia' => 'WCAus', 'wcaus' => 'WCAus',
    'gulf of aden' => 'GOA', 'goa' => 'GOA', 'sw passage' => 'SW Pass', 'sw pass' => 'SW Pass', 'southwest pass' => 'SW Pass', 'southwest passage' => 'SW Pass', 'south west passage' => 'SW Pass',
    'black sea' => 'Black Sea', 'bsea' => 'Black Sea', 'b.sea' => 'Black Sea', 'baltic' => 'Baltic', 'baltic sea' => 'Baltic',
    'caribbean' => 'Caribbean', 'caribs' => 'Caribbean', 'carribean' => 'Caribbean', 'turkish straits' => 'Turkish Straits',
    'turkiye' => 'Turkiye', 'türkiye' => 'Turkiye', 'turkey' => 'Turkiye', 'marmara' => 'Marmara', 'aegean' => 'Aegean', 'adriatic' => 'Adriatic',
    'japan-korea' => 'Japan-Korea', 'japan/korea' => 'Japan-Korea', 'japan korea' => 'Japan-Korea', 'atlantic' => 'Atlantic', 'pacific' => 'Pacific',
    'great lakes' => 'Great Lakes', 'st lawrence' => 'St Lawrence', 'river plate' => 'River Plate', 'east coast mexico' => 'Mexico East Coast',
];

/** Countries and places that keep their name (typos within a small edit distance are corrected). */
const HB_PLACES = [
    'Albania', 'Algeria', 'Angola', 'Argentina', 'Australia', 'Bahrain', 'Bangladesh', 'Belgium', 'Benin', 'Brazil', 'Bulgaria', 'Cameroon', 'Canada',
    'Chile', 'China', 'Colombia', 'Congo', 'Croatia', 'Cuba', 'Cyprus', 'Denmark', 'Djibouti', 'Ecuador', 'Egypt', 'Estonia', 'Finland', 'France',
    'Gabon', 'Georgia', 'Germany', 'Ghana', 'Greece', 'Guinea', 'Guyana', 'Hong Kong', 'Iceland', 'India', 'Indonesia', 'Iran', 'Iraq', 'Ireland',
    'Israel', 'Italy', 'Ivory Coast', 'Jamaica', 'Japan', 'Jordan', 'Kenya', 'Korea', 'South Korea', 'North Korea', 'Kuwait', 'Latvia', 'Lebanon', 'Liberia',
    'Libya', 'Lithuania', 'Madagascar', 'Malaysia', 'Malta', 'Mauritania', 'Mauritius', 'Mexico', 'Montenegro', 'Morocco', 'Mozambique', 'Myanmar',
    'Namibia', 'Netherlands', 'New Zealand', 'Nigeria', 'Norway', 'Oman', 'Pakistan', 'Panama', 'Papua New Guinea', 'Peru', 'Philippines', 'Poland',
    'Portugal', 'Qatar', 'Romania', 'Russia', 'Saudi Arabia', 'Senegal', 'Sierra Leone', 'Singapore', 'Slovenia', 'Somalia', 'Spain', 'Sri Lanka',
    'Sudan', 'Suriname', 'Sweden', 'Syria', 'Taiwan', 'Tanzania', 'Thailand', 'Togo', 'Trinidad', 'Tunisia', 'Ukraine', 'United Arab Emirates', 'UAE',
    'United Kingdom', 'UK', 'United States', 'USA', 'Uruguay', 'Venezuela', 'Vietnam', 'Yemen', 'Paraguay', 'Puerto Rico', 'Dominican Republic',
    'Guatemala', 'Honduras', 'Costa Rica', 'El Salvador', 'Nicaragua', 'Haiti', 'Bahamas', 'Fiji', 'New Caledonia', 'Cambodia', 'Brunei', 'Maldives',
    'Gibraltar', 'Suez', 'Panama Canal', 'Kiel Canal', 'Bosphorus', 'Dardanelles', 'Cape of Good Hope', 'Strait of Malacca', 'Sakhalin', 'Kamchatka',
];

/** Plain-language qualifiers around a known place: "North China", "Mexico West Coast", "South India". */
const HB_QUALIFIER = '(?:North|South|East|West|Central|Northern|Southern|Eastern|Western|NE|NW|SE|SW|Upper|Lower)';

/**
 * Port country (ISO 3166-1 alpha-2, as in Ports) → the region names a market report would use for a ship open there,
 * most specific first. Used by Market comparables and the Tonnage & Cargo market level.
 */
const HB_COUNTRY_REGIONS = [
    'TR' => ['Turkiye', 'Marmara', 'Black Sea', 'EMED', 'Med'], 'GR' => ['Greece', 'Aegean', 'EMED', 'Med'], 'CY' => ['Cyprus', 'EMED', 'Med'],
    'EG' => ['Egypt', 'EMED', 'Med'], 'IL' => ['Israel', 'EMED', 'Med'], 'LB' => ['Lebanon', 'EMED', 'Med'], 'SY' => ['Syria', 'EMED', 'Med'],
    'RO' => ['Romania', 'Black Sea'], 'BG' => ['Bulgaria', 'Black Sea'], 'UA' => ['Ukraine', 'Black Sea'], 'GE' => ['Georgia', 'Black Sea'], 'RU' => ['Russia', 'Black Sea', 'Baltic'],
    'IT' => ['Italy', 'Adriatic', 'Med', 'WMED', 'EMED'], 'HR' => ['Croatia', 'Adriatic', 'Med'], 'SI' => ['Slovenia', 'Adriatic', 'Med'], 'AL' => ['Albania', 'Adriatic', 'Med'],
    'ES' => ['Spain', 'WMED', 'Med', 'Cont'], 'FR' => ['France', 'Cont', 'WMED', 'Med'], 'PT' => ['Portugal', 'Cont'], 'MT' => ['Malta', 'Med'],
    'MA' => ['Morocco', 'WMED', 'WAFR'], 'DZ' => ['Algeria', 'WMED', 'Med'], 'TN' => ['Tunisia', 'Med'], 'LY' => ['Libya', 'Med'],
    'NL' => ['Netherlands', 'ARAG', 'Cont', 'UKC'], 'BE' => ['Belgium', 'ARAG', 'Cont', 'UKC'], 'DE' => ['Germany', 'Cont', 'Baltic', 'UKC'], 'GB' => ['UK', 'UKC', 'Cont'],
    'IE' => ['Ireland', 'UKC', 'Cont'], 'DK' => ['Denmark', 'Baltic', 'Cont'], 'NO' => ['Norway', 'Cont'], 'SE' => ['Sweden', 'Baltic'], 'FI' => ['Finland', 'Baltic'],
    'PL' => ['Poland', 'Baltic'], 'LT' => ['Lithuania', 'Baltic'], 'LV' => ['Latvia', 'Baltic'], 'EE' => ['Estonia', 'Baltic'],
    'US' => ['USG', 'USEC', 'USWC', 'PNW', 'SW Pass'], 'CA' => ['Canada', 'ECNA', 'St Lawrence', 'Canada West Coast'], 'MX' => ['Mexico', 'Mexico East Coast', 'Mexico West Coast'],
    'BR' => ['Brazil', 'ECSA'], 'AR' => ['Argentina', 'River Plate', 'ECSA'], 'UY' => ['Uruguay', 'River Plate', 'ECSA'], 'CO' => ['Colombia', 'NCSA', 'Caribbean'],
    'VE' => ['Venezuela', 'NCSA', 'Caribbean'], 'GY' => ['Guyana', 'NCSA'], 'SR' => ['Suriname', 'NCSA'], 'TT' => ['Trinidad', 'NCSA', 'Caribbean'],
    'PE' => ['Peru', 'WCSA'], 'CL' => ['Chile', 'WCSA'], 'EC' => ['Ecuador', 'WCSA'],
    'CN' => ['China', 'North China', 'South China', 'FEAST'], 'JP' => ['Japan', 'Japan-Korea', 'FEAST'], 'KR' => ['South Korea', 'Japan-Korea', 'FEAST'],
    'TW' => ['Taiwan', 'FEAST'], 'HK' => ['Hong Kong', 'South China', 'FEAST'], 'ID' => ['Indonesia', 'SEA'], 'MY' => ['Malaysia', 'SEA'], 'TH' => ['Thailand', 'SEA'],
    'VN' => ['Vietnam', 'SEA'], 'PH' => ['Philippines', 'SEA'], 'SG' => ['Singapore', 'SEA'], 'KH' => ['Cambodia', 'SEA'], 'MM' => ['Myanmar', 'SEA'],
    'IN' => ['India', 'WCI', 'ECI'], 'PK' => ['Pakistan', 'WCI'], 'BD' => ['Bangladesh', 'ECI'], 'LK' => ['Sri Lanka', 'ECI'],
    'AE' => ['UAE', 'PG'], 'SA' => ['Saudi Arabia', 'PG', 'RSea'], 'QA' => ['Qatar', 'PG'], 'KW' => ['Kuwait', 'PG'], 'OM' => ['Oman', 'PG'], 'BH' => ['Bahrain', 'PG'],
    'IR' => ['Iran', 'PG'], 'IQ' => ['Iraq', 'PG'], 'JO' => ['Jordan', 'RSea'], 'DJ' => ['Djibouti', 'RSea', 'EAFR'], 'SD' => ['Sudan', 'RSea'],
    'ZA' => ['SAF'], 'MZ' => ['Mozambique', 'EAFR', 'SAF'], 'KE' => ['Kenya', 'EAFR'], 'TZ' => ['Tanzania', 'EAFR'], 'MG' => ['Madagascar', 'EAFR'],
    'NG' => ['Nigeria', 'WAFR'], 'GH' => ['Ghana', 'WAFR'], 'CI' => ['Ivory Coast', 'WAFR'], 'SN' => ['Senegal', 'WAFR'], 'GN' => ['Guinea', 'WAFR'],
    'CM' => ['Cameroon', 'WAFR'], 'TG' => ['Togo', 'WAFR'], 'BJ' => ['Benin', 'WAFR'], 'AO' => ['Angola', 'WAFR'], 'MR' => ['Mauritania', 'WAFR'], 'SL' => ['Sierra Leone', 'WAFR'],
    'AU' => ['Australia', 'ECAus', 'WCAus'], 'NZ' => ['New Zealand'], 'PG' => ['Papua New Guinea', 'SEA'],
];

/** Segment for a ship size (used when a position has no segment name): Handysize < 40k, Supramax < 60k, Ultramax < 67k … */
function hb_segment_for_dwt(?float $dwt): ?string
{
    if (!$dwt || $dwt < 10000) {
        return null;
    }
    foreach ([[40000, 'Handysize'], [60000, 'Supramax'], [67000, 'Ultramax'], [80000, 'Panamax'], [90000, 'Kamsarmax'], [120000, 'Post-Panamax'], [200000, 'Capesize']] as [$max, $seg]) {
        if ($dwt < $max) {
            return $seg;
        }
    }
    return 'Newcastlemax';
}

/** "Handy" → "Handysize" … null when the word is not a dry-bulk segment. */
function hb_segment(string $s): ?string
{
    $w = strtolower(trim(preg_replace('/\s+(?:bulk carriers?|charter rates?)$/i', '', trim($s))));
    $w = str_replace([' ', '_'], ['-', '-'], $w);
    return match (true) {
        in_array($w, ['handy', 'handysize', 'handymax', 'hsize', 'hs'], true) => 'Handysize',
        in_array($w, ['supra', 'supramax', 'smx'], true) => 'Supramax',
        in_array($w, ['ultra', 'ultramax', 'umx'], true) => 'Ultramax',
        in_array($w, ['panamax', 'pmx', 'pana'], true) => 'Panamax',
        in_array($w, ['kamsarmax', 'kmx', 'kamsar'], true) => 'Kamsarmax',
        in_array($w, ['post-panamax', 'postpanamax', 'ppmx'], true) => 'Post-Panamax',
        in_array($w, ['capesize', 'cape', 'capes'], true) => 'Capesize',
        in_array($w, ['newcastlemax', 'ncmax', 'newcastle-max'], true) => 'Newcastlemax',
        default => null,
    };
}

function hb_lev_match(string $w, array $names): ?string
{
    $l = mb_strlen($w);
    if ($l < 5) {
        return null;
    }
    $max = $l >= 8 ? 2 : 1;
    $best = null;
    $bestD = $max + 1;
    $tie = false;
    foreach ($names as $n) {
        $d = levenshtein($w, strtolower($n));
        if ($d < $bestD) {
            [$best, $bestD, $tie] = [$n, $d, false];
        } elseif ($d === $bestD) {
            $tie = true;
        }
    }
    return $best !== null && !$tie ? $best : null;
}

/**
 * One region / place name → ['code' => …, 'mapped' => bool].
 * Order: an abbreviation in brackets ("East Coast South America (ECSA)") → saved user mapping → dictionary → known place
 * (with North/South… or "… West Coast" qualifiers) → small typo correction. Unknown → the cleaned name, mapped = false.
 * $user: lower-case alias → code (ch_region_aliases).
 */
function hb_region(string $raw, array $user = []): array
{
    $s = trim(preg_replace('/\s+/u', ' ', $raw), " \t.,;");
    if ($s === '') {
        return ['code' => null, 'mapped' => true];
    }
    if (preg_match('/^(.*?)\s*\(([A-Za-z][A-Za-z.\-]{1,9})\)$/', $s, $m)) {
        $abbr = strtolower($m[2]);
        return ['code' => $user[$abbr] ?? HB_REGION_ALIASES[$abbr] ?? strtoupper($m[2]), 'mapped' => true];
    }
    $k = mb_strtolower($s);
    if (isset($user[$k])) {
        return ['code' => $user[$k], 'mapped' => true];
    }
    if (isset(HB_REGION_ALIASES[$k])) {
        return ['code' => HB_REGION_ALIASES[$k], 'mapped' => true];
    }
    foreach (HB_PLACES as $p) {
        if (strcasecmp($p, $s) === 0) {
            return ['code' => $p, 'mapped' => true];
        }
    }
    // "North China", "South India", "Mexico West Coast", "Canada East Coast"
    if (preg_match('/^(' . HB_QUALIFIER . ')\s+(.+)$/i', $s, $m) || preg_match('/^(.+?)\s+((?:East|West|North|South)\s+Coast)$/i', $s, $m2)) {
        [$q, $base, $after] = isset($m2) && $m2 ? [$m2[2], $m2[1], true] : [$m[1], $m[2], false];
        $b = hb_region($base, $user);
        if ($b['mapped'] && $b['code'] !== null) {
            $q = ucwords(strtolower($q));
            $q = in_array(strtoupper($q), ['NE', 'NW', 'SE', 'SW'], true) ? strtoupper($q) : $q;
            return ['code' => $after ? "{$b['code']} {$q}" : "{$q} {$b['code']}", 'mapped' => true];
        }
    }
    $fix = hb_lev_match($k, [...HB_PLACES, ...array_keys(array_filter(HB_REGION_ALIASES, fn($a) => strlen($a) >= 5, ARRAY_FILTER_USE_KEY))]);
    if ($fix !== null) {
        return ['code' => HB_REGION_ALIASES[strtolower($fix)] ?? $fix, 'mapped' => true];
    }
    return ['code' => $s, 'mapped' => false];
}

/** "a long period (1 year)" / "6-8 months" / "about 12 months" → months; null when there is no duration. */
function hb_period_months(string $s): ?float
{
    if (!preg_match('/(\d+(?:\.\d+)?)(?:\s*[-–]\s*(\d+(?:\.\d+)?))?\s*(years?|yrs?|months?|mos?)\b/i', $s, $m)) {
        return null;
    }
    $n = isset($m[2]) && $m[2] !== '' ? ((float) $m[1] + (float) $m[2]) / 2 : (float) $m[1];
    return stripos($m[3], 'y') === 0 ? $n * 12 : $n;
}

/** "$1 million" / "1,000,000" / "800k" / "$1.25m" → number */
function hb_money(string $n, ?string $unit = null): ?float
{
    $v = hb_num($n);
    if ($v === null) {
        return null;
    }
    $u = strtolower((string) $unit);
    return $u === 'k' ? $v * 1000 : (in_array($u, ['m', 'mio', 'million', 'mln'], true) ? $v * 1e6 : $v);
}
