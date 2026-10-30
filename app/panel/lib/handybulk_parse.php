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
