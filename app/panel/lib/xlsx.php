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
    $esc = fn($s) => htmlspecialchars((string) $s, ENT_XML1 | ENT_QUOTES, 'UTF-8');
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

    $name = $esc($opt['sheet'] ?? 'Sheet1');
    $zip = class_exists('ZipArchive') ? new ZipArchive() : new MiniZip();
    if ($zip->open($file, ZipArchive_CREATE_OVERWRITE) !== true) {
        throw new RuntimeException('XLSX yazılamadı: ' . $file);
    }
    $zip->addFromString('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        . '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
        . '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        . '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        . '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>');
    $zip->addFromString('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        . '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
    $zip->addFromString('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        . '<sheets><sheet name="' . $name . '" sheetId="1" r:id="rId1"/></sheets></workbook>');
    $zip->addFromString('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        . '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
        . '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
    $zip->addFromString('xl/worksheets/sheet1.xml', $sheet);
    $zip->addFromString('xl/styles.xml', $styles);
    $zip->close();
}
