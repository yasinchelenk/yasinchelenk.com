<?php

declare(strict_types=1);

/**
 * Küçük XLSX yazıcısı (ZipArchive). Hücre: skaler ya da ['v' => değer, 's' => stil].
 * Stiller: bold · money (#,##0.00) · bold_money · title (14pt kalın) · dim (gri) · head (kalın, gri zemin)
 * xlsx_write($file, $rows, ['cols' => [genişlik…], 'merge' => ['A1:D1'], 'sheet' => 'DA'])
 */
const ZipArchive_CREATE_OVERWRITE = 1 | 8;          // ZipArchive::CREATE | ZipArchive::OVERWRITE (eklenti yokken de tanımlı)

/** zip eklentisi olmayan sunucular için: sıkıştırmasız (stored) zip yazıcısı, ZipArchive ile aynı arayüz */
final class MiniZip
{
    private string $file = '';
    /** @var array<string, string> */
    private array $entries = [];

    public function open(string $file, int $flags = 0): bool
    {
        $this->file = $file;
        return true;
    }

    public function addFromString(string $name, string $data): bool
    {
        $this->entries[$name] = $data;
        return true;
    }

    public function close(): bool
    {
        [$out, $central, $time, $date] = ['', '', 0, (1 << 5) | 1 | ((2020 - 1980) << 9)];
        foreach ($this->entries as $name => $data) {
            $crc = crc32($data);
            $len = strlen($data);
            $head = pack('vvvvvVVVvv', 20, 0, 0, $time, $date, $crc, $len, $len, strlen($name), 0);
            $central .= pack('V', 0x02014b50) . pack('v', 20) . $head . pack('vvvVV', 0, 0, 0, 0, strlen($out)) . $name;
            $out .= pack('V', 0x04034b50) . $head . $name . $data;
        }
        $n = count($this->entries);
        $out .= $central . pack('VvvvvVVv', 0x06054b50, 0, 0, $n, $n, strlen($central), strlen($out), 0);

        return file_put_contents($this->file, $out) !== false;
    }
}

const XLSX_STYLES =['' => 0, 'bold' => 1, 'money' => 2, 'bold_money' => 3, 'title' => 4, 'dim' => 5, 'head' => 6, 'head_r' => 7];

function xlsx_col(int $i): string
{
    $s = '';
    for ($i++; $i > 0; $i = intdiv($i - 1, 26)) {
        $s = chr(65 + ($i - 1) % 26) . $s;
    }

    return $s;
}

function xlsx_write(string $file, array $rows, array $opt = []): void
{
    xlsx_write_book($file, [['rows' => $rows, 'name' => $opt['sheet'] ?? 'Sheet1'] + $opt]);
}

/** Several sheets: [['name' => 'Events', 'rows' => […], 'cols' => […], 'merge' => […]], …] */
function xlsx_write_book(string $file, array $sheets): void
{
    $esc = fn($s) => htmlspecialchars((string) $s, ENT_XML1 | ENT_QUOTES, 'UTF-8');
    $xmls = [];
    foreach (array_values($sheets) as $opt) {
    $rows = $opt['rows'] ?? [];
    $sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        . '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">';
    if (!empty($opt['cols'])) {
        $sheet .= '<cols>';
        foreach ($opt['cols'] as $i => $w) {
            $sheet .= sprintf('<col min="%d" max="%d" width="%.1f" customWidth="1"/>', $i + 1, $i + 1, $w);
        }
        $sheet .= '</cols>';
    }
    $sheet .= '<sheetData>';
    foreach (array_values($rows) as $r => $cells) {
        $sheet .= '<row r="' . ($r + 1) . '">';
        foreach (array_values((array) $cells) as $c => $cell) {
            $v = is_array($cell) ? ($cell['v'] ?? null) : $cell;
            $s = XLSX_STYLES[is_array($cell) ? ($cell['s'] ?? '') : ''] ?? 0;
            if ($v === null || $v === '') {
                if ($s) {
                    $sheet .= '<c r="' . xlsx_col($c) . ($r + 1) . '" s="' . $s . '"/>';
                }
                continue;
            }
            $ref = xlsx_col($c) . ($r + 1);
            $sheet .= is_int($v) || is_float($v)
                ? "<c r=\"{$ref}\" s=\"{$s}\"><v>" . (is_float($v) ? round($v, 6) : $v) . '</v></c>'
                : "<c r=\"{$ref}\" s=\"{$s}\" t=\"inlineStr\"><is><t xml:space=\"preserve\">" . $esc($v) . '</t></is></c>';
        }
        $sheet .= '</row>';
    }
    $sheet .= '</sheetData>';
    if (!empty($opt['merge'])) {
        $sheet .= '<mergeCells count="' . count($opt['merge']) . '">' . implode('', array_map(fn($m) => '<mergeCell ref="' . $m . '"/>', $opt['merge'])) . '</mergeCells>';
    }
    $sheet .= '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="portrait" fitToWidth="1"/></worksheet>';
    $xmls[] = $sheet;
    }

    $styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        . '<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts>'
        . '<fonts count="4"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><name val="Arial"/></font><font><b/><sz val="14"/><name val="Arial"/></font><font><sz val="9"/><color rgb="FF6B7A8C"/><name val="Arial"/></font></fonts>'
        . '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8EEF4"/><bgColor indexed="64"/></patternFill></fill></fills>'
        . '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
        . '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
        . '<cellXfs count="8"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
        . '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
        . '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
        . '<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>'
        . '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
        . '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
        . '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>'
        . '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="right"/></xf>'
        . '</cellXfs></styleSheet>';

    // Sheet names: unique, max 31 characters, no []:*?/\
    $names = [];
    foreach (array_values($sheets) as $i => $opt) {
        $n = trim(preg_replace('/[\[\]:*?\/\\\\]+/', ' ', mb_substr((string) ($opt['name'] ?? 'Sheet' . ($i + 1)), 0, 31))) ?: 'Sheet' . ($i + 1);
        while (in_array($n, $names, true)) {
            $n = mb_substr($n, 0, 28) . ' ' . ($i + 1);
        }
        $names[] = $n;
    }
    $zip = class_exists('ZipArchive') ? new ZipArchive() : new MiniZip();
    if ($zip->open($file, ZipArchive_CREATE_OVERWRITE) !== true) {
        throw new RuntimeException('XLSX yazılamadı: ' . $file);
    }
    $zip->addFromString('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        . '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
        . '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        . implode('', array_map(fn($i) => '<Override PartName="/xl/worksheets/sheet' . ($i + 1) . '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>', array_keys($xmls)))
        . '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>');
    $zip->addFromString('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        . '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
    $zip->addFromString('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        . '<sheets>' . implode('', array_map(fn($i) => '<sheet name="' . $esc($names[$i]) . '" sheetId="' . ($i + 1) . '" r:id="rId' . ($i + 1) . '"/>', array_keys($xmls))) . '</sheets></workbook>');
    $zip->addFromString('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        . implode('', array_map(fn($i) => '<Relationship Id="rId' . ($i + 1) . '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' . ($i + 1) . '.xml"/>', array_keys($xmls)))
        . '<Relationship Id="rId' . (count($xmls) + 1) . '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
    foreach ($xmls as $i => $xml) {
        $zip->addFromString('xl/worksheets/sheet' . ($i + 1) . '.xml', $xml);
    }
    $zip->addFromString('xl/styles.xml', $styles);
    $zip->close();
}

// ---------------------------------------------------------------- Reading (SOF import)

/** Files of a zip as name → contents, with ZipArchive or (without the extension) a small central-directory reader. */
function zip_entries(string $file, array $wanted, bool $noExtension = false): array
{
    $out = [];
    if (class_exists('ZipArchive') && !$noExtension) {
        $zip = new ZipArchive();
        if ($zip->open($file) !== true) {
            return [];
        }
        for ($i = 0; $i < $zip->numFiles; $i++) {
            $name = (string) $zip->getNameIndex($i);
            foreach ($wanted as $re) {
                if (preg_match($re, $name)) {
                    $out[$name] = (string) $zip->getFromIndex($i);
                }
            }
        }
        $zip->close();
        return $out;
    }
    $data = (string) file_get_contents($file);
    $eocd = strrpos($data, "PK\x05\x06");
    if ($eocd === false) {
        return [];
    }
    $e = unpack('vdisk/vcd_disk/ventries_disk/ventries/Vsize/Voffset', substr($data, $eocd + 4, 16));
    $p = $e['offset'];
    for ($i = 0; $i < $e['entries'] && substr($data, $p, 4) === "PK\x01\x02"; $i++) {
        $h = unpack('vmade/vneed/vflags/vmethod/vtime/vdate/Vcrc/Vcsize/Vusize/vnlen/velen/vclen/vdisk/viattr/Veattr/Vlocal', substr($data, $p + 4, 42));
        $name = substr($data, $p + 46, $h['nlen']);
        $p += 46 + $h['nlen'] + $h['elen'] + $h['clen'];
        if (!array_filter($wanted, fn($re) => preg_match($re, $name))) {
            continue;
        }
        $l = unpack('vnlen/velen', substr($data, $h['local'] + 26, 4));
        $raw = substr($data, $h['local'] + 30 + $l['nlen'] + $l['elen'], $h['csize']);
        $out[$name] = $h['method'] === 8 ? (string) @gzinflate($raw) : $raw;
    }
    return $out;
}

/** First worksheet of an .xlsx as rows of strings (shared strings, inline strings, numbers as stored). */
function xlsx_read(string $file, int $maxRows = 3000, int $maxCols = 30, bool $noExtension = false): array
{
    $files = zip_entries($file, ['#^xl/sharedStrings\.xml$#', '#^xl/worksheets/sheet\d+\.xml$#'], $noExtension);
    $sheets = array_filter(array_keys($files), fn($n) => str_starts_with($n, 'xl/worksheets/'));
    natsort($sheets);
    $sheet = reset($sheets);
    if (!$sheet) {
        return [];
    }
    $shared = [];
    if (!empty($files['xl/sharedStrings.xml'])) {
        $sx = @simplexml_load_string($files['xl/sharedStrings.xml']);
        foreach ($sx?->si ?? [] as $si) {
            $shared[] = isset($si->t) ? (string) $si->t : implode('', array_map(fn($r) => (string) $r->t, iterator_to_array($si->r, false)));
        }
    }
    $xml = @simplexml_load_string($files[$sheet]);
    $rows = [];
    foreach ($xml?->sheetData->row ?? [] as $row) {
        $cells = [];
        foreach ($row->c as $c) {
            $ref = (string) $c['r'];
            $col = 0;
            foreach (str_split(preg_replace('/\d+/', '', $ref)) as $ch) {
                $col = $col * 26 + (ord($ch) - 64);
            }
            $col = max(1, $col) - 1;
            if ($col >= $maxCols) {
                continue;
            }
            $t = (string) $c['t'];
            $v = $t === 's' ? ($shared[(int) $c->v] ?? '') : ($t === 'inlineStr' ? (string) $c->is->t : (string) $c->v);
            $cells[$col] = $v;
        }
        if ($cells) {
            $line = array_fill(0, max(array_keys($cells)) + 1, '');
            foreach ($cells as $i => $v) {
                $line[$i] = $v;
            }
            $rows[] = $line;
        }
        if (count($rows) >= $maxRows) {
            break;
        }
    }
    return $rows;
}
