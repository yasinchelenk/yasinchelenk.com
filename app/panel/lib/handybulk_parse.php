<?php

declare(strict_types=1);

/**
 * HandyBulk page parsers — pure functions (no DB, no network), tested by bin/handybulk-tests.php.
 * Only numbers and structured fields come out; paragraphs / commentary text are never returned for storage.
 */

const HB_MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** "28-October-2026" → "2026-10-28"; anything else → null */
function hb_date(string $s): ?string
{
    if (!preg_match('/^\s*(\d{1,2})-([A-Za-z]+)-(\d{4})\b/', $s, $m)) {
        return null;
    }
    $mo = array_search(strtolower($m[2]), HB_MONTHS, true);
    if ($mo === false || (int) $m[1] < 1 || !checkdate($mo + 1, (int) $m[1], (int) $m[3])) {
        return null;
    }
    return sprintf('%04d-%02d-%02d', $m[3], $mo + 1, $m[1]);
}

/** "2,652" / "35,245.50" / "$1,670" → float */
function hb_num(string $s): ?float
{
    $t = preg_replace('/[,\s$]/', '', $s);
    return is_numeric($t) ? (float) $t : null;
}

function hb_dom(string $html): DOMDocument
{
    $doc = new DOMDocument();
    $prev = libxml_use_internal_errors(true);
    $doc->loadHTML('<?xml encoding="utf-8" ?>' . $html, LIBXML_NOWARNING | LIBXML_NOERROR | LIBXML_NONET);
    libxml_clear_errors();
    libxml_use_internal_errors($prev);
    return $doc;
}

function hb_text(?DOMNode $n): string
{
    return $n ? trim(preg_replace('/\s+/u', ' ', html_entity_decode($n->textContent, ENT_QUOTES | ENT_HTML5, 'UTF-8'))) : '';
}

function hb_next_element(DOMNode $n): ?DOMElement
{
    for ($x = $n->nextSibling; $x; $x = $x->nextSibling) {
        if ($x instanceof DOMElement) {
            return $x;
        }
    }
    return null;
}

/**
 * Baltic report paragraph → [{code, value, change}] (port of engine/market.js parseBaltic; same tests).
 * Indices BDI/BCI/BPI/BSI/BHSI and the average TC earnings CAPE/PMX/SMX/HANDY ("earnings" or "income").
 */
function hb_parse_baltic(string $text): array
{
    $s = preg_replace('/\s+/u', ' ', $text);
    $UP = 'increased|rose|gained|climbed|jumped|added|went up|up';
    $DOWN = 'decreased|fell|dropped|declined|lost|slipped|eased|went down|down|shed';
    $SAME = 'remained unchanged|was unchanged|unchanged|remained flat|was flat|flat|steady|remained steady';
    $sign = fn(string $w) => preg_match("/^({$DOWN})$/i", trim($w)) ? -1 : (preg_match("/^({$SAME})$/i", trim($w)) ? 0 : 1);
    $tcOf = ['BCI' => 'CAPE', 'BPI' => 'PMX', 'BSI' => 'SMX', 'BHSI' => 'HANDY'];
    preg_match_all('/\((BDI|BCI|BPI|BSI|BHSI)\)/', $s, $marks, PREG_OFFSET_CAPTURE);
    $out = [];
    $seen = [];
    $add = function (string $code, ?float $v, ?float $c) use (&$out, &$seen): void {
        if ($v !== null && !isset($seen[$code])) {
            $seen[$code] = true;
            $out[] = ['code' => $code, 'value' => $v, 'change' => $c];
        }
    };
    $n = count($marks[1]);
    for ($i = 0; $i < $n; $i++) {
        $code = $marks[1][$i][0];
        $from = $marks[0][$i][1];
        $clause = substr($s, $from, ($marks[0][$i + 1][1] ?? strlen($s)) - $from);
        if (preg_match("/({$UP}|{$DOWN})\\s+(?:by\\s+)?([\\d,.]+)\\s*points?(?:\\s*,)?\\s+(?:to(?:\\s+reach)?|at|reaching)\\s+([\\d,.]+)/i", $clause, $a)) {
            $add($code, hb_num($a[3]), $sign($a[1]) * hb_num($a[2]));
        } elseif (preg_match("/(?:{$SAME})\\s+at\\s+([\\d,.]+)/i", $clause, $b)) {
            $add($code, hb_num($b[1]), 0.0);
        }
        $c = strtolower($clause);
        $seg = str_contains($c, 'capesize') ? 'CAPE' : (str_contains($c, 'panamax') ? 'PMX' : (preg_match('/supramax|ultramax/', $c) ? 'SMX' : (str_contains($c, 'handysize') ? 'HANDY' : ($tcOf[$code] ?? null))));
        if (!$seg) {
            continue;
        }
        if (preg_match("/average daily (?:earnings|income)[^.\$]*?({$UP}|{$DOWN})\\s+(?:by\\s+)?\\$\\s?([\\d,.]+)\\s+(?:to(?:\\s+reach)?|at)\\s+\\$\\s?([\\d,.]+)/i", $clause, $t)) {
            $add($seg, hb_num($t[3]), $sign($t[1]) * hb_num($t[2]));
        } elseif (preg_match("/average daily (?:earnings|income)[^.\$]*?(?:{$SAME})\\s+at\\s+\\$\\s?([\\d,.]+)/i", $clause, $u)) {
            $add($seg, hb_num($u[1]), 0.0);
        }
    }
    return $out;
}

/**
 * BDI page → ['days' => [['date', 'rows' => [...]]], 'weekly' => [['date', 'segment' => heading]], 'archive' => [paths]].
 * A daily report is a "<p>DD-Month-YYYY</p>" directly followed by a paragraph that names the BDI;
 * a dated paragraph followed by a heading (<strong>) starts the weekly commentary (only its date / headings are noted).
 */
function hb_parse_bdi_page(string $html): array
{
    $doc = hb_dom($html);
    $days = [];
    $weekly = [];
    $seen = [];
    foreach (iterator_to_array($doc->getElementsByTagName('p')) as $p) {
        $t = hb_text($p);
        $date = preg_match('/^\d{1,2}-[A-Za-z]+-\d{4}$/', $t) ? hb_date($t) : null;
        if (!$date) {
            continue;
        }
        $next = hb_next_element($p);
        if (!$next || $next->nodeName !== 'p') {
            continue;
        }
        $strong = $next->getElementsByTagName('strong')->length + $next->getElementsByTagName('b')->length;
        if ($strong) {
            $weekly[] = ['date' => $date, 'heading' => mb_substr(hb_text($next), 0, 120)];
            continue;
        }
        if (isset($seen[$date]) || !str_contains(hb_text($next), '(BDI)')) {
            continue;
        }
        $rows = hb_parse_baltic(hb_text($next));
        if ($rows) {
            $seen[$date] = true;
            $days[] = ['date' => $date, 'rows' => $rows];
        }
    }
    preg_match_all('#href="(?:https://www\.handybulk\.com)?(/baltic-dry-index/(\d{4})/([a-z]+)/)"#', $html, $m, PREG_SET_ORDER);
    $archive = [];
    foreach ($m as $x) {
        if (in_array($x[3], HB_MONTHS, true)) {
            $archive[(int) $x[2] * 100 + array_search($x[3], HB_MONTHS, true)] = $x[1];
        }
    }
    ksort($archive);
    return ['days' => $days, 'weekly' => $weekly, 'archive' => array_values($archive)];
}

/**
 * Ship Bunker page → ['as_of' => 'YYYY-MM-DD'|null, 'prices' => [['port', 'is_average', 'grades' => ['VLSFO' => 988.0, 'MGO' => 1602.5, …]]]].
 * Tables whose first header cell is "Port…" (e.g. "Ship Bunker Prices", "Selected Ports"); grade columns are read from
 * the header ("VLSFO Price $/mt" → VLSFO), so a new grade column is picked up without code changes.
 */
function hb_parse_bunker_page(string $html): array
{
    $doc = hb_dom($html);
    $asOf = null;
    foreach ($doc->getElementsByTagName('p') as $p) {
        if (preg_match('/^(\d{1,2}-[A-Za-z]+-\d{4})\s+Daily Updated/i', hb_text($p), $m)) {
            $asOf = hb_date($m[1]);
            break;
        }
    }
    $prices = [];
    $seen = [];
    foreach ($doc->getElementsByTagName('table') as $table) {
        $rows = iterator_to_array($table->getElementsByTagName('tr'));
        if (!$rows) {
            continue;
        }
        $head = array_map('hb_text', iterator_to_array($rows[0]->getElementsByTagName('th')) ?: iterator_to_array($rows[0]->getElementsByTagName('td')));
        if (!$head || !preg_match('/^port/i', $head[0])) {
            continue;
        }
        $grades = [];
        foreach (array_slice($head, 1, null, true) as $i => $h) {
            if (preg_match('/^([A-Z][A-Z0-9]{1,9})\b/', $h, $g)) {
                $grades[$i] = $g[1];
            }
        }
        foreach (array_slice($rows, 1) as $tr) {
            $cells = array_map('hb_text', iterator_to_array($tr->getElementsByTagName('td')));
            if (count($cells) < 2 || $cells[0] === '') {
                continue;
            }
            $name = $cells[0];
            $avg = (bool) preg_match('/\baverage\b/i', $name);
            $port = $avg ? trim(preg_replace('/\s*bunker price\s*$/i', '', $name)) : $name;
            $vals = [];
            foreach ($grades as $i => $grade) {
                $v = hb_num($cells[$i] ?? '');
                if ($v !== null) {
                    $vals[$grade] = $v;
                }
            }
            if ($vals && !isset($seen[strtolower($port)])) {
                $seen[strtolower($port)] = true;
                $prices[] = ['port' => $port, 'is_average' => $avg, 'grades' => $vals];
            }
        }
    }
    return ['as_of' => $asOf, 'prices' => $prices];
}

/**
 * Ship Charter Rates page → [
 *   'as_of' => 'YYYY-MM-DD'|null,
 *   'trips' => [['segment', 'open', 'via' => [..], 'to', 'rate', 'bb']],   "<Segment> Charter Rates" sections (segment from the heading)
 *   'period' => [['segment', 'open', 'rate', 'months']],                    "Period Charter Rates"
 *   'weeks' => [['week', 'segment', 'routes' => [[label, rate]]]],          "Bulk Carrier Charter Rates Week 44" tables
 *   'year_tc' => [['label', 'segment', 'dwt', 'rate']],                    "1 Year Time Charter Rates" table
 *   'skipped' => lines not understood, 'unknown_segments' => [headings]]
 * Region names come back raw (the importer normalizes them with hb_region()). Reading stops at the first <h1> (the article).
 */
function hb_parse_rates_page(string $html): array
{
    $doc = hb_dom($html);
    $out = ['as_of' => null, 'trips' => [], 'period' => [], 'weeks' => [], 'year_tc' => [], 'skipped' => 0, 'unknown_segments' => []];
    $start = null;
    foreach ($doc->getElementsByTagName('p') as $p) {
        if (preg_match('/^(\d{1,2}-[A-Za-z]+-\d{4})\s+Daily Updated/i', hb_text($p), $m)) {
            $out['as_of'] = hb_date($m[1]);
            $start = $p;
            break;
        }
    }
    if (!$start) {
        return $out;
    }
    // Sections: a heading → its text lines (split on <br>) and tables, until the next heading or the article's <h1>
    $sections = [];
    $cur = null;
    $walk = function (DOMNode $n) use (&$walk, &$sections, &$cur): bool {
        if ($n instanceof DOMText) {
            if ($cur !== null) {
                $sections[$cur]['text'] .= $n->textContent;
            }
            return true;
        }
        if (!$n instanceof DOMElement) {
            return true;
        }
        $tag = strtolower($n->nodeName);
        if ($tag === 'h1') {
            return false;
        }
        if ($tag === 'h2' || $tag === 'h3') {
            $sections[] = ['heading' => hb_text($n), 'text' => '', 'tables' => []];
            $cur = array_key_last($sections);
            return true;
        }
        if ($cur === null) {
            return true;
        }
        if ($tag === 'br') {
            $sections[$cur]['text'] .= "\n";
            return true;
        }
        if ($tag === 'table') {
            $rows = [];
            foreach ($n->getElementsByTagName('tr') as $tr) {
                $cells = [];
                foreach ($tr->childNodes as $td) {
                    if ($td instanceof DOMElement && in_array(strtolower($td->nodeName), ['td', 'th'], true)) {
                        $cells[] = hb_text($td);
                    }
                }
                $rows[] = $cells;
            }
            $sections[$cur]['tables'][] = $rows;
            return true;
        }
        foreach (iterator_to_array($n->childNodes) as $c) {
            if (!$walk($c)) {
                return false;
            }
        }
        $sections[$cur]['text'] .= "\n";
        return true;
    };
    for ($n = $start->nextSibling; $n; $n = $n->nextSibling) {
        if (!$walk($n)) {
            break;
        }
    }

    $lines = fn(string $t) => array_values(array_filter(array_map(
        fn($l) => trim(preg_replace('/\s+/u', ' ', html_entity_decode($l, ENT_QUOTES | ENT_HTML5, 'UTF-8')), " \t•*-·"), explode("\n", $t)), fn($l) => $l !== ''));
    $rate = '\$?\s?(\d[\d,]*(?:\.\d+)?)\s*(k\b)?';
    foreach ($sections as $s) {
        $head = $s['heading'];
        if (preg_match('/\bweek\s+(\d{1,2})\b/i', $head, $wk)) {
            foreach ($s['tables'] as $t) {
                if (count($t) < 2 || count($t[0]) < 2) {
                    continue;
                }
                $seg = hb_segment($t[0][0]);
                $routes = [];
                foreach (array_slice($t[0], 1, null, true) as $i => $label) {
                    $v = hb_num($t[1][$i] ?? '');
                    if ($label !== '' && $v !== null) {
                        $routes[] = [$label, $v];
                    }
                }
                if ($seg && $routes) {
                    $out['weeks'][] = ['week' => (int) $wk[1], 'segment' => $seg, 'routes' => $routes];
                } elseif ($routes) {
                    $out['unknown_segments'][] = $t[0][0];
                }
            }
            continue;
        }
        if (preg_match('/\b1\s*year\s+time\s+charter/i', $head)) {
            foreach ($s['tables'] as $t) {
                foreach (($t[0] ?? []) as $i => $label) {
                    $v = hb_num($t[1][$i] ?? '');
                    if ($v !== null && preg_match('/^([A-Za-z\-]+)\s+(\d+(?:\.\d+)?)\s*K\b/i', $label, $m) && ($seg = hb_segment($m[1]))) {
                        $out['year_tc'][] = ['label' => "{$seg} {$m[2]}K", 'segment' => $seg, 'dwt' => (int) round((float) $m[2] * 1000), 'rate' => $v];
                    }
                }
            }
            continue;
        }
        $period = (bool) preg_match('/^period\b/i', $head);
        $named = preg_match('/^(.+?)\s+charter rates$/i', $head, $hm);
        $headSeg = $named && !$period ? hb_segment($hm[1]) : null;
        if (!$period && !$headSeg) {
            if ($named && trim($s['text']) !== '') {
                $out['unknown_segments'][] = $head;
            }
            continue;
        }
        foreach ($lines($s['text']) as $l) {
            if ($period && preg_match("/^(\\S+)\\s+open\\s+(.+?)\\s+chartered\\s+out\\s+(?:around|at|about|abt)\\s+{$rate}\\s*(?:\\/\\s*day)?\\s*(.*)$/i", $l, $m)
                && ($seg = hb_segment($m[1]))) {
                $out['period'][] = ['segment' => $seg, 'open' => trim($m[2]), 'rate' => hb_money($m[3], $m[4] ?: null), 'months' => hb_period_months($m[5])];
                continue;
            }
            if (!$period && preg_match("/^(\\S+)\\s+open\\s+(.+?)(?:\\s+via\\s+(.+?))?\\s+to\\s+(.+?)\\s+(?:fixed\\s+)?(?:around|at|about|abt)\\s+{$rate}(.*)$/i", $l, $m)) {
                $bb = preg_match('/\+\s*\$?\s?(\d[\d,]*(?:\.\d+)?)\s*(k|m|mio|million)?\s*(?:BB|ballast bonus|GBB)\b/i', $m[7], $b) ? hb_money($b[1], ($b[2] ?? '') ?: null) : null;
                $out['trips'][] = ['segment' => hb_segment($m[1]) ?? $headSeg, 'open' => trim($m[2]),
                    'via' => $m[3] !== '' ? array_values(array_filter(array_map('trim', preg_split('/\s+(?:via|and)\s+|\s*,\s*/i', $m[3])))) : [],
                    'to' => trim($m[4]), 'rate' => hb_money($m[5], $m[6] ?: null), 'bb' => $bb];
                continue;
            }
            $out['skipped']++;
        }
    }
    return $out;
}

/**
 * BDI page weekly commentary → ['weeks' => [['date', 'fixtures' => [...], 'routes' => [...]]]].
 * A weekly block is a "<p>DD-Month-YYYY</p>" followed by a bold segment heading; its body paragraphs are read sentence
 * by sentence and only the structured values come out — the sentences themselves are never returned.
 */
function hb_parse_weekly(string $html): array
{
    $doc = hb_dom($html);
    $weeks = [];
    $cur = null;
    foreach (iterator_to_array($doc->getElementsByTagName('p')) as $p) {
        $t = hb_text($p);
        if (preg_match('/^\d{1,2}-[A-Za-z]+-\d{4}$/', $t)) {
            $next = hb_next_element($p);
            $weekly = $next && $next->nodeName === 'p' && ($next->getElementsByTagName('strong')->length || $next->getElementsByTagName('b')->length);
            $cur = $weekly && ($d = hb_date($t)) ? $d : null;
            if ($cur && !isset($weeks[$cur])) {
                $weeks[$cur] = ['date' => $cur, 'fixtures' => [], 'routes' => []];
            }
            continue;
        }
        if ($cur === null || $p->getElementsByTagName('strong')->length || str_contains($t, '(BDI) ')) {
            continue;   // outside a weekly block, a segment heading, or a daily index paragraph
        }
        foreach (preg_split('/(?<=[.!?])\s+(?=[A-Z])/u', $t) as $s) {
            array_push($weeks[$cur]['fixtures'], ...hb_parse_fixture_sentence($s));
            array_push($weeks[$cur]['routes'], ...hb_parse_route_sentence($s));
        }
    }
    return ['weeks' => array_values($weeks)];
}

/**
 * One sentence → reported fixtures [{segment, dwt, open, via, to, type, rate, bb}] (raw region names).
 * "A 64,000 DWT ultramax bulk carrier opening in Brazil was fixed to Egypt at approximately $36,000, while another …"
 * Each vessel mention starts a clause; a clause needs a fixing verb and a dollar rate, otherwise it is dropped.
 */
function hb_parse_fixture_sentence(string $s): array
{
    $s = str_replace(['’s ', "'s "], ' ', preg_replace('/\s+/u', ' ', $s));
    if (!preg_match_all('/\b(?:an?|another)\s+(\d[\d,.]*)\s*(K)?\s*DWT\s+([A-Za-z\-]+)(?:\s+bulk\s+carriers?)?/i', $s, $ms, PREG_OFFSET_CAPTURE | PREG_SET_ORDER)) {
        return [];
    }
    $out = [];
    $stop = '(?=\s+(?:was|were|is|has|secured|securing|obtained|obtaining|fixed|fixing|reportedly|also|for|achieved|achieving|and|at|with)\b|\s*[,;.]|$)';
    $region = fn(?string $x) => $x === null ? null : (trim(preg_replace('/^the\s+/i', '', trim($x)), " ,.;") ?: null);
    foreach ($ms as $i => $m) {
        $from = $m[0][1];
        $clause = substr($s, $from, (($ms[$i + 1][0][1] ?? strlen($s)) - $from));
        $seg = hb_segment($m[3][0]);
        if (!$seg || !preg_match('/\b(?:fixed|fixing|secured|securing|obtained|obtaining|achieved|achieving|chartered)\b/i', $clause)) {
            continue;
        }
        $bb = null;
        if (preg_match('/(?:plus\s+(?:a\s+)?|\+\s*)\$\s?(\d[\d,.]*)\s*(million|mln|m|k)?\s*(?:ballast\s+bonus|BB|GBB)\b(?:\s*\((?:ballast bonus)\))?/i', $clause, $b)) {
            $bb = hb_money($b[1], $b[2] ?? null);
            $clause = str_replace($b[0], '', $clause);
        }
        if (!preg_match('/(?:approximately|around|about|at|of)\s+\$\s?(\d[\d,.]*)\s*(k\b)?/i', $clause, $r) && !preg_match('/\$\s?(\d[\d,.]*)\s*(k\b)?/i', $clause, $r)) {
            continue;
        }
        $open = preg_match("/\\bopen(?:ing)?\\s+(?:in\\s+|at\\s+|off\\s+)?(.+?){$stop}/i", $clause, $o) ? $region($o[1])
            : (preg_match('/\bfrom\s+(.+?)\s+to\s+/i', $clause, $o) ? $region($o[1]) : null);
        $via = null;
        if (preg_match('/\bvia\s+(.+?)(?=\s+(?:back\s+to|to|returning|at|for)\b|\s*[,;.]|$)/i', $clause, $v)) {
            $via = $region($v[1]);
        } elseif (preg_match('/\bfor\s+an?\s+(.+?)\s+round\s+voyage/i', $clause, $v) && !preg_match('/^(?:short|long|quick)$/i', $v[1])) {
            $via = $region($v[1]);
        }
        $to = preg_match('/\b(?:back\s+to|returning\s+to|to)\s+(?!approximately|around|about|reach|recover)(.+?)(?=\s+(?:at|for|in|on|with|plus|while|by)\b|\s*[,;.]|$)/i', $clause, $d) ? $region($d[1]) : null;
        if ($to !== null && preg_match('/^\$|^\d/', $to)) {
            $to = null;
        }
        $type = match (true) {
            (bool) preg_match('/short[\s-]+period/i', $clause) => 'short period',
            (bool) preg_match('/\bperiod\b|\b\d+\s*(?:-\s*\d+\s*)?(?:months?|years?)\b/i', $clause) => 'period',
            (bool) preg_match('/round\s+voyage|\bback\s+to\b|\breturning\s+to\b/i', $clause) => 'round voyage',
            default => 'trip',
        };
        $out[] = ['segment' => $seg, 'dwt' => (int) round(hb_num($m[1][0]) * (strtoupper($m[2][0] ?? '') === 'K' ? 1000 : 1)), 'open' => $open, 'via' => $via,
            'to' => in_array($type, ['short period', 'period'], true) ? null : $to, 'type' => $type, 'rate' => hb_money($r[1], ($r[2] ?? '') ?: null), 'bb' => $bb];
    }
    return $out;
}

/**
 * One sentence → Baltic route values [{code, point: open|close|single, value, unit}].
 * Codes: "(C5)", "C3 index", "(C5TC182)", "Capesize 5TC", "182 5TC", "(P5TC)" … → C5, C3, C5TC, P5TC.
 * "from $A … to $B" → open + close; "began the week at $A" → open; "to $B by Friday / by the close", "closing level of $B" → close;
 * otherwise the first "to / at / towards $X" → single. Changes ("by $2,796") are not values.
 */
function hb_parse_route_sentence(string $s): array
{
    $re = '/\b(?:(Capesize|Panamax|Supramax|Ultramax|Handysize|182|82|63|58|38)\s+(\d{1,2})TC|(C|P|S|HS)(\d{1,2})TC\d*|(C|P|S|HS)(\d{1,2}[A-Z]?))\b(?!\s*(?:DWT|K\b|,\d))/';
    if (!preg_match_all($re, $s, $ms, PREG_OFFSET_CAPTURE | PREG_SET_ORDER)) {
        return [];
    }
    $prefix = ['capesize' => 'C', '182' => 'C', 'panamax' => 'P', '82' => 'P', 'supramax' => 'S', 'ultramax' => 'S', '63' => 'S', '58' => 'S', 'handysize' => 'HS', '38' => 'HS'];
    $mentions = [];
    foreach ($ms as $m) {
        $code = ($m[1][0] ?? '') !== '' ? $prefix[strtolower($m[1][0])] . $m[2][0] . 'TC' : ((($m[3][0] ?? '') !== '') ? $m[3][0] . $m[4][0] . 'TC' : $m[5][0] . $m[6][0]);
        $end = $m[0][1] + strlen($m[0][0]);
        if ($mentions && end($mentions)['code'] === $code) {
            continue;   // "Baltic Capesize 5TC … (C5TC182)": one window
        }
        $mentions[] = ['code' => $code, 'at' => $end];
    }
    $out = [];
    $money = '\$\s?(\d[\d,]*(?:\.\d+)?)';
    foreach ($mentions as $i => $mn) {
        $w = substr($s, $mn['at'], ($mentions[$i + 1]['at'] ?? strlen($s) + 1) - $mn['at']);
        $vals = [];
        if (preg_match("/\\bfrom\\s+(?:approximately\\s+)?{$money}.*?\\bto\\s+(?:approximately\\s+|around\\s+|about\\s+)?{$money}/i", $w, $x)) {
            $vals = [['open', $x[1]], ['close', $x[2]]];
        } else {
            if (preg_match("/\\b(?:began|opened|started)\\s+the\\s+week\\s+at\\s+{$money}/i", $w, $x)) {
                $vals[] = ['open', $x[1]];
            }
            if (preg_match("/\\b(?:to|at)\\s+(?:approximately\\s+|around\\s+|about\\s+)?{$money}\\s+by\\s+(?:Friday|the\\s+close|the\\s+end\\s+of\\s+the\\s+week|week'?s\\s+end)/i", $w, $x)
                || preg_match("/\\bclos(?:ing\\s+level\\s+of|ed\\s+(?:the\\s+week\\s+)?at)\\s+{$money}/i", $w, $x)) {
                $vals[] = ['close', $x[1]];
            }
            if (!$vals && preg_match("/\\b(?:to|at|towards|around)\\s+(?:approximately\\s+|around\\s+|about\\s+)?{$money}/i", $w, $x)) {
                $vals[] = ['single', $x[1]];
            }
        }
        foreach ($vals as [$point, $v]) {
            $n = hb_num($v);
            if ($n !== null) {
                $out[] = ['code' => $mn['code'], 'point' => $point, 'value' => $n, 'unit' => str_ends_with($mn['code'], 'TC') || $n >= 300 ? 'USD/day' : 'USD/t'];
            }
        }
    }
    return $out;
}

/**
 * Dry Bulk Shipping News page → ['days' => [['date', 'items' => n]], 'archive' => [month paths, oldest first]].
 * The page has no headlines or per-item links: only the date and the number of items are kept — never the text.
 */
function hb_parse_news_page(string $html): array
{
    $doc = hb_dom($html);
    $days = [];
    $cur = null;
    foreach (iterator_to_array($doc->getElementsByTagName('p')) as $p) {
        $t = hb_text($p);
        if (preg_match('/^\d{1,2}-[A-Za-z]+-\d{4}$/', $t)) {
            $cur = hb_date($t);
            if ($cur) {
                $days[$cur] ??= ['date' => $cur, 'items' => 0];
            }
            continue;
        }
        if ($cur && mb_strlen($t) >= 80) {
            $days[$cur]['items']++;
        }
    }
    preg_match_all('#href="(?:https://www\.handybulk\.com)?(/dry-bulk-shipping-news/(\d{4})/([a-z]+)/)"#', $html, $m, PREG_SET_ORDER);
    $archive = [];
    foreach ($m as $x) {
        if (in_array($x[3], HB_MONTHS, true)) {
            $archive[(int) $x[2] * 100 + array_search($x[3], HB_MONTHS, true)] = $x[1];
        }
    }
    ksort($archive);
    return ['days' => array_values(array_filter($days, fn($d) => $d['items'] > 0)), 'archive' => array_values($archive)];
}

/** Chartering Lessons page → [['url', 'slug', 'title']] (unique, in page order) and the next page, if the list is paginated. */
function hb_parse_lessons_page(string $html): array
{
    $doc = hb_dom($html);
    $out = [];
    $next = null;
    foreach ($doc->getElementsByTagName('a') as $a) {
        $cls = ' ' . $a->getAttribute('class') . ' ';
        $href = trim($a->getAttribute('href'));
        if (str_contains($cls, ' chartering-lessons-row ') && preg_match('#^(?:https://www\.handybulk\.com)?/([a-z0-9][a-z0-9\-]*)/?$#', $href, $m)) {
            $title = hb_text($a->getElementsByTagName('span')->item(0) ?? $a);
            if ($title !== '' && !isset($out[$m[1]])) {
                $out[$m[1]] = ['url' => HbFetcher::ORIGIN . "/{$m[1]}/", 'slug' => $m[1], 'title' => mb_substr($title, 0, 200)];
            }
        }
        if (strtolower($a->getAttribute('rel')) === 'next' && preg_match('#^(?:https://www\.handybulk\.com)?(/chartering-lessons/page/\d+/)$#', $href, $m)) {
            $next = $m[1];
        }
    }
    return ['lessons' => array_values($out), 'next' => $next];
}

/**
 * Keyword categories for lesson titles (spec §1.5), first match wins; users can change a lesson's category.
 * Each keyword is a regex fragment matched from a word start ("liabilit" → liability / liabilities; "ore\b" only the word).
 */
const HB_LESSON_CATEGORIES = [
    'Laytime & Demurrage' => ['laytime', 'demurrage', 'despatch', 'dispatch\b', 'notice of readiness', 'nor\b', 'laydays', 'time ?sheet', 'statement of facts', 'wibon', 'wipon', 'shinc', 'shex', 'reversible', 'arrived ship'],
    'Voyage Estimation' => ['voyage estimat', 'voyage calculation', 'tce\b', 'time charter equivalent', 'break-?even', 'intake calculation', 'voyage result'],
    'Stowage Factor' => ['stowage factor'],
    'B/L & LOI' => ['bills? of lading', 'b\/l\b', 'letter of indemnity', 'loi\b', "mate'?s receipt", 'switch bill'],
    'Bunkers' => ['bunker', 'fuel', 'vlsfo', 'mgo\b', 'hsfo', 'scrubber', 'consumption'],
    'Insurance & GA' => ['insurance', 'p ?& ?i\b', 'general average', 'hull and machinery', 'h&m\b', 'war risk', 'salvage', 'underwrit', 'piracy'],
    'Law & Arbitration' => ['arbitration', 'lmaa', 'law\b', 'laws\b', 'legal', 'court', 'dispute', 'liabilit', 'hague', 'hamburg rules', 'rotterdam rules', 'liens?\b', 'claims?\b', 'damages', 'frustration', 'jurisdiction', 'carriage of goods', 'attachment', 'arrest'],
    'S&P & Finance' => ['sale and purchase', 's&p\b', 'ship finance', 'financ', 'mortgage', 'valuation', 'newbuild', 'shipbuilding', 'demolition', 'recycling', 'second-?hand', 'memorandum of agreement', 'investment'],
    'Time Charter' => ['time charter', 'hire\b', 'off-?hire', 'nype', 'baltime', 'delivery', 'redelivery', 'ballast bonus', 'trip charter', 'period charter'],
    'Voyage Charter' => ['voyage charter', 'freight', 'dead ?freight', 'coa\b', 'contract of affreightment'],
    'CP Clauses & Forms' => ['clauses?\b', 'charter ?part(?:y|ies)', 'charter-party', 'bimco', 'gencon', 'riders?\b', 'recap', 'cp forms?'],
    'Ship Types & Sizes' => ['handysize', 'handymax', 'supramax', 'ultramax', 'panamax', 'kamsarmax', 'capesize', 'newcastlemax', 'ship sizes?', 'ship types?', 'vessel types?', 'bulk carrier types', 'geared', 'gearless', 'deadweight', 'dwt\b', 'tonnage\b', 'tpc\b', 'grain capacity', 'bale capacity'],
    'Market & Economics' => ['markets?\b', 'index', 'bdi\b', 'freight rates?', 'economics', 'cycles?\b', 'demand', 'supply', 'ffa\b', 'forward freight', 'baltic exchange'],
    'Cargoes' => ['cargo', 'ores?\b', 'iron ore', 'coal', 'grains?\b', 'wheat', 'corn\b', 'maize', 'soybean', 'cement', 'clinker', 'fertili', 'steel', 'logs\b', 'timber', 'scrap', 'bauxite', 'alumina', 'sugar', 'salt\b', 'petcoke', 'sulphur', 'urea', 'concentrates?\b', 'bulk [a-z]+ shipping'],
];

function hb_lesson_category(string $title): string
{
    $t = mb_strtolower($title);
    foreach (HB_LESSON_CATEGORIES as $cat => $words) {
        foreach ($words as $w) {
            if (preg_match('/(?<![a-z0-9])' . $w . '/u', $t)) {
                return $cat;
            }
        }
    }
    return 'Other';
}

/**
 * Cargo named in a stowage factor lesson title: "Wheat Stowage Factor" → Wheat, "Coal Stowage Factor in Bulk Shipping" → Coal,
 * "Log Cargo Stowage Factors: …" → Log Cargo; a general lesson ("Stowage Factor (SF)", "… Cargo Orders: Stowage Factor …") → null.
 */
function hb_sf_cargo(string $title): ?string
{
    $t = trim(preg_replace('/\s*:.*$/', '', $title));
    if (!preg_match('/^(.*?)\s*stowage\s+factors?\b/i', $t, $m)) {
        return null;
    }
    $c = trim(preg_replace('/\s+(?:cargo|cargoes)$/i', '', trim($m[1])));
    return $c === '' || mb_strlen($c) > 40 ? null : $c;
}

/**
 * Stowage factor values in a lesson page → [['low', 'high', 'unit', 'cbm_low', 'cbm_high']] (numbers and units only).
 * Units: cbm/mt (m3/t, cubic metres per tonne) and cuft/lt (ft3/lt, cubic feet per long ton; 1 cbm/mt = 35.8813 cuft/lt).
 */
function hb_parse_sf_values(string $html): array
{
    $doc = hb_dom($html);
    $text = '';
    foreach ($doc->getElementsByTagName('p') as $p) {
        $text .= ' ' . hb_text($p);
    }
    foreach ($doc->getElementsByTagName('td') as $td) {
        $text .= ' ' . hb_text($td);
    }
    $unit = '(cbm\s*\/\s*(?:mt|t|ton|tonne)|m3\s*\/\s*(?:mt|t)|m³\s*\/\s*(?:mt|t)|cubic met(?:re|er)s?\s+per\s+(?:metric\s+)?(?:tonne|ton)|cu\.?\s?ft\.?\s*\/\s*(?:lt|ton)|cuft\s*\/\s*lt|cbft\s*\/\s*lt|ft3\s*\/\s*lt|ft³\s*\/\s*lt|cubic\s+feet\s+per\s+(?:long\s+)?ton)';
    preg_match_all('/(\d{1,3}(?:\.\d{1,3})?)\s*(?:(?:-|–|to)\s*(\d{1,3}(?:\.\d{1,3})?))?\s*' . $unit . '/iu', $text, $ms, PREG_SET_ORDER);
    $out = [];
    foreach ($ms as $m) {
        $lo = (float) $m[1];
        $hi = ($m[2] ?? '') !== '' ? (float) $m[2] : $lo;
        $feet = (bool) preg_match('/ft|feet/i', $m[3]);
        [$cl, $ch] = $feet ? [$lo / 35.8813, $hi / 35.8813] : [$lo, $hi];
        if ($cl < 0.3 || $ch > 6 || $ch < $cl) {
            continue;   // not a plausible bulk stowage factor
        }
        $key = sprintf('%.3f-%.3f', $cl, $ch);
        $out[$key] ??= ['low' => $lo, 'high' => $hi, 'unit' => $feet ? 'cuft/lt' : 'cbm/mt', 'cbm_low' => round($cl, 3), 'cbm_high' => round($ch, 3)];
    }
    return array_slice(array_values($out), 0, 8);
}
