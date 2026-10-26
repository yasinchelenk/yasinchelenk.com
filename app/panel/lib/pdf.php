<?php

declare(strict_types=1);

/**
 * Küçük PDF yazıcısı (dış kütüphane yok; paylaşımlı hostingde çalışır).
 * Helvetica / Helvetica-Bold standart fontları, Windows-1254 kodlamasıyla: Türkçe harfler (Ğ ğ İ ı Ş ş)
 * /Differences ile standart glif adlarına eşlenir. Koordinatlar sol üstten, birim pt (A4 = 595 × 842).
 */
final class Pdf
{
    public const W = 595.28;
    public const H = 841.89;

    /** @var list<string> */
    private array $pages = [];
    private string $cur = '';

    private const HELV = [32 => 278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556,
        278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944,
        667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556,
        500, 722, 500, 500, 500, 334, 260, 334, 584];
    private const HELV_B = [32 => 278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556,
        333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944,
        667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611,
        556, 778, 556, 556, 500, 389, 280, 389, 584];
    /** Türkçe ve aksanlı harflerin genişliği için taban harf */
    private const BASE = ['Ç' => 'C', 'ç' => 'c', 'Ğ' => 'G', 'ğ' => 'g', 'İ' => 'I', 'ı' => 'i', 'Ö' => 'O', 'ö' => 'o', 'Ş' => 'S', 'ş' => 's', 'Ü' => 'U', 'ü' => 'u',
        'Â' => 'A', 'â' => 'a', 'Î' => 'I', 'î' => 'i', 'Û' => 'U', 'û' => 'u', 'É' => 'E', 'é' => 'e', '’' => "'", '‘' => "'", '“' => '"', '”' => '"', '–' => '-', '—' => '-', '•' => 'o', '€' => 'C', '₺' => 'T'];

    public function addPage(): void
    {
        if ($this->cur !== '') {
            $this->pages[] = $this->cur;
        }
        $this->cur = ' ';
    }

    public function pageCount(): int
    {
        return count($this->pages) + ($this->cur !== '' ? 1 : 0);
    }

    public function width(string $s, float $size, bool $bold = false): float
    {
        $t = $bold ? self::HELV_B : self::HELV;
        $w = 0;
        foreach (mb_str_split($s) as $ch) {
            $ch = self::BASE[$ch] ?? $ch;
            $o = strlen($ch) === 1 ? ord($ch) : 0;
            $w += $t[$o] ?? 556;
        }

        return $w * $size / 1000;
    }

    /** Sığmayan metni kelime kelime satırlara böler */
    public function wrap(string $s, float $maxWidth, float $size, bool $bold = false): array
    {
        $out = [];
        foreach (preg_split('/\R/u', $s) as $para) {
            $line = '';
            foreach (preg_split('/\s+/u', trim($para)) as $word) {
                $try = $line === '' ? $word : "{$line} {$word}";
                if ($line !== '' && $this->width($try, $size, $bold) > $maxWidth) {
                    $out[] = $line;
                    $line = $word;
                } else {
                    $line = $try;
                }
            }
            $out[] = $line;
        }

        return $out;
    }

    /** Metin; $align: L | R | C (R/C'de $x hizalama noktası) */
    public function text(float $x, float $y, string $s, float $size = 10, bool $bold = false, string $align = 'L', ?array $rgb = null): void
    {
        if ($s === '') {
            return;
        }
        if ($align !== 'L') {
            $w = $this->width($s, $size, $bold);
            $x -= $align === 'R' ? $w : $w / 2;
        }
        $enc = @iconv('UTF-8', 'CP1254//TRANSLIT', strtr($s, ['₺' => 'TL', '€' => 'EUR'])) ?: preg_replace('/[^\x20-\x7E]/', '?', $s);
        $enc = strtr($enc, ['\\' => '\\\\', '(' => '\\(', ')' => '\\)', "\r" => '', "\n" => ' ']);
        $color = $rgb ? sprintf('%.3F %.3F %.3F rg ', ...array_map(fn($c) => $c / 255, $rgb)) : '0 0 0 rg ';
        $this->cur .= sprintf("BT %s/%s %.2F Tf %.2F %.2F Td (%s) Tj ET\n", $color, $bold ? 'F2' : 'F1', $size, $x, self::H - $y, $enc);
    }

    public function line(float $x1, float $y1, float $x2, float $y2, float $width = 0.5, array $rgb = [0, 0, 0]): void
    {
        $this->cur .= sprintf("%.3F %.3F %.3F RG %.2F w %.2F %.2F m %.2F %.2F l S\n", $rgb[0] / 255, $rgb[1] / 255, $rgb[2] / 255, $width, $x1, self::H - $y1, $x2, self::H - $y2);
    }

    public function rect(float $x, float $y, float $w, float $h, ?array $fill = null, ?array $stroke = null, float $lw = 0.5): void
    {
        $ops = '';
        if ($fill) {
            $ops .= sprintf('%.3F %.3F %.3F rg ', $fill[0] / 255, $fill[1] / 255, $fill[2] / 255);
        }
        if ($stroke) {
            $ops .= sprintf('%.3F %.3F %.3F RG %.2F w ', $stroke[0] / 255, $stroke[1] / 255, $stroke[2] / 255, $lw);
        }
        $op = $fill && $stroke ? 'B' : ($fill ? 'f' : 'S');
        $this->cur .= sprintf("%s%.2F %.2F %.2F %.2F re %s\n", $ops, $x, self::H - $y - $h, $w, $h, $op);
    }

    public function output(): string
    {
        $pages = $this->pages;
        if ($this->cur !== '') {
            $pages[] = $this->cur;
        }
        $objs = [];
        $enc = '<< /Type /Encoding /BaseEncoding /WinAnsiEncoding /Differences [208 /Gbreve 221 /Idotaccent 222 /Scedilla 240 /gbreve 253 /dotlessi 254 /scedilla] >>';
        $objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
        $objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding 5 0 R >>";
        $objs[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding 5 0 R >>";
        $objs[5] = $enc;
        $kids = [];
        $n = 6;
        foreach ($pages as $content) {
            $objs[$n] = sprintf('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %.2F %.2F] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents %d 0 R >>', self::W, self::H, $n + 1);
            $objs[$n + 1] = "<< /Length " . strlen($content) . " >>\nstream\n{$content}\nendstream";
            $kids[] = "{$n} 0 R";
            $n += 2;
        }
        $objs[2] = '<< /Type /Pages /Kids [' . implode(' ', $kids) . '] /Count ' . count($kids) . ' >>';
        ksort($objs);

        $out = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
        $offsets = [];
        foreach ($objs as $i => $body) {
            $offsets[$i] = strlen($out);
            $out .= "{$i} 0 obj\n{$body}\nendobj\n";
        }
        $xref = strlen($out);
        $out .= "xref\n0 " . (count($objs) + 1) . "\n0000000000 65535 f \n";
        foreach ($offsets as $off) {
            $out .= sprintf("%010d 00000 n \n", $off);
        }
        $out .= "trailer\n<< /Size " . (count($objs) + 1) . " /Root 1 0 R >>\nstartxref\n{$xref}\n%%EOF";

        return $out;
    }
}
