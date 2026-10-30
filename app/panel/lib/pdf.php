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

    /** After all content: runs $fn($pdf, $pageNo, $total) on every page, e.g. for "Page 2 of 5" footers. */
    public function eachPage(callable $fn): void
    {
        if ($this->cur !== '') {
            $this->pages[] = $this->cur;
        }
        $total = count($this->pages);
        foreach ($this->pages as $i => $content) {
            $this->cur = $content;
            $fn($this, $i + 1, $total);
            $this->pages[$i] = $this->cur;
        }
        $this->cur = '';
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
    public function text(float $x, float $y, string $s, float $size = 10, bool $bold = false, string $align = 'L', ?array $rgb = null, float $cs = 0): void
    {
        if ($s === '') {
            return;
        }
        if ($align !== 'L') {
            $w = $this->width($s, $size, $bold) + $cs * max(0, mb_strlen($s) - 1);
            $x -= $align === 'R' ? $w : $w / 2;
        }
        if ($cs) {
            $this->cur .= sprintf("%.3F Tc\n", $cs);
        }
        $enc = @iconv('UTF-8', 'CP1254//TRANSLIT', strtr($s, ['₺' => 'TL', '€' => 'EUR'])) ?: preg_replace('/[^\x20-\x7E]/', '?', $s);
        $enc = strtr($enc, ['\\' => '\\\\', '(' => '\\(', ')' => '\\)', "\r" => '', "\n" => ' ']);
        $color = $rgb ? sprintf('%.3F %.3F %.3F rg ', ...array_map(fn($c) => $c / 255, $rgb)) : '0 0 0 rg ';
        $this->cur .= sprintf("BT %s/%s %.2F Tf %.2F %.2F Td (%s) Tj ET\n", $color, $bold ? 'F2' : 'F1', $size, $x, self::H - $y, $enc);
        if ($cs) {
            $this->cur .= "0 Tc\n";
        }
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

    /** @var array<string, array{name: string, w: int, h: int, cs: string, filter: string, parms: ?string, data: string, smask: ?string}> */
    private array $images = [];

    /**
     * Görsel (JPEG ya da 8 bit PNG; PNG şeffaflığı SMask olur). $w/$h'den biri verilirse oran korunur.
     * Okunamayan görsel sessizce atlanır (belge görselsiz basılır). Dönen değer çizilen yükseklik.
     */
    public function image(string $bytes, float $x, float $y, ?float $w = null, ?float $h = null): float
    {
        $key = md5($bytes);
        $img = $this->images[$key] ??= self::loadImage($bytes, 'Im' . (count($this->images) + 1));
        if (!$img) {
            unset($this->images[$key]);
            return 0;
        }
        if ($w === null && $h === null) {
            $w = $img['w'] * 0.75;
        }
        $w ??= $h * $img['w'] / $img['h'];
        $h ??= $w * $img['h'] / $img['w'];
        $this->cur .= sprintf("q %.2F 0 0 %.2F %.2F %.2F cm /%s Do Q\n", $w, $h, $x, self::H - $y - $h, $img['name']);

        return $h;
    }

    private static function loadImage(string $b, string $name): ?array
    {
        if (str_starts_with($b, "\xFF\xD8")) {
            $info = @getimagesizefromstring($b);
            if (!$info) {
                return null;
            }
            $cs = match ($info['channels'] ?? 3) { 1 => '/DeviceGray', 4 => '/DeviceCMYK', default => '/DeviceRGB' };
            return ['name' => $name, 'w' => $info[0], 'h' => $info[1], 'cs' => $cs, 'filter' => 'DCTDecode', 'parms' => null, 'data' => $b, 'smask' => null];
        }
        if (!str_starts_with($b, "\x89PNG\r\n\x1a\n")) {
            return null;
        }
        $pos = 8;
        $idat = '';
        $plte = '';
        $trns = '';
        $hdr = null;
        while ($pos + 8 <= strlen($b)) {
            $len = unpack('N', substr($b, $pos, 4))[1];
            $type = substr($b, $pos + 4, 4);
            $data = substr($b, $pos + 8, $len);
            $pos += 12 + $len;
            match ($type) {
                'IHDR' => $hdr = unpack('Nw/Nh/Cdepth/Ctype/Ccomp/Cfilter/Cinterlace', $data),
                'PLTE' => $plte = $data,
                'tRNS' => $trns = $data,
                'IDAT' => $idat .= $data,
                default => null,
            };
            if ($type === 'IEND') {
                break;
            }
        }
        if (!$hdr || $hdr['depth'] !== 8 || $hdr['interlace'] !== 0) {
            return null;                                    // 16 bit / interlaced PNG desteklenmez
        }
        [$w, $h, $type] = [$hdr['w'], $hdr['h'], $hdr['type']];
        $colors = [0 => 1, 2 => 3, 3 => 1, 4 => 2, 6 => 4][$type] ?? null;
        if ($colors === null) {
            return null;
        }
        $cs = match ($type) {
            0, 4 => '/DeviceGray',
            3 => '[/Indexed /DeviceRGB ' . (intdiv(strlen($plte), 3) - 1) . ' <' . bin2hex($plte) . '>]',
            default => '/DeviceRGB',
        };
        // Saydamlık yoksa IDAT olduğu gibi gömülür (PNG öngörücüsü PDF'te de var)
        if (in_array($type, [0, 2], true) || ($type === 3 && $trns === '')) {
            return ['name' => $name, 'w' => $w, 'h' => $h, 'cs' => $cs, 'filter' => 'FlateDecode',
                'parms' => "<< /Predictor 15 /Colors {$colors} /BitsPerComponent 8 /Columns {$w} >>", 'data' => $idat, 'smask' => null];
        }
        // Saydamlık: satır filtreleri çözülür, renk ve alfa ayrılır
        $raw = @gzuncompress($idat);
        if ($raw === false) {
            return null;
        }
        $stride = $w * $colors;
        $prev = array_fill(0, $stride, 0);
        $color = '';
        $alpha = '';
        $alphaOf = $type === 3 ? array_values(unpack('C*', $trns . str_repeat("\xFF", 256))) : null;
        for ($y = 0, $p = 0; $y < $h; $y++) {
            $f = ord($raw[$p]);
            $line = array_values(unpack('C*', substr($raw, $p + 1, $stride)));
            $p += $stride + 1;
            if ($f !== 0) {
                for ($i = 0; $i < $stride; $i++) {
                    $a = $i >= $colors ? $line[$i - $colors] : 0;
                    $up = $prev[$i];
                    if ($f === 1) {
                        $add = $a;
                    } elseif ($f === 2) {
                        $add = $up;
                    } elseif ($f === 3) {
                        $add = ($a + $up) >> 1;
                    } else {
                        $c = $i >= $colors ? $prev[$i - $colors] : 0;
                        $pp = $a + $up - $c;
                        $pa = abs($pp - $a);
                        $pb = abs($pp - $up);
                        $pc = abs($pp - $c);
                        $add = $pa <= $pb && $pa <= $pc ? $a : ($pb <= $pc ? $up : $c);
                    }
                    $line[$i] = ($line[$i] + $add) & 0xFF;
                }
            }
            $prev = $line;
            if ($type === 3) {
                $color .= pack('C*', ...$line);
                $alpha .= pack('C*', ...array_map(fn($ix) => $alphaOf[$ix], $line));
            } else {
                $cc = $colors - 1;
                for ($i = 0; $i < $stride; $i += $colors) {
                    $color .= $cc === 1 ? chr($line[$i]) : chr($line[$i]) . chr($line[$i + 1]) . chr($line[$i + 2]);
                    $alpha .= chr($line[$i + $cc]);
                }
            }
        }

        return ['name' => $name, 'w' => $w, 'h' => $h, 'cs' => $cs, 'filter' => 'FlateDecode', 'parms' => null, 'data' => gzcompress($color), 'smask' => gzcompress($alpha)];
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
        // Görseller (XObject) sayfalardan önce numaralanır
        $n = 6;
        $xobj = [];
        foreach ($this->images as $img) {
            if ($img['smask'] !== null) {
                $objs[$n] = sprintf("<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length %d >>\nstream\n%s\nendstream",
                    $img['w'], $img['h'], strlen($img['smask']), $img['smask']);
                $smask = " /SMask {$n} 0 R";
                $n++;
            } else {
                $smask = '';
            }
            $objs[$n] = sprintf("<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace %s /BitsPerComponent 8 /Filter /%s%s%s /Length %d >>\nstream\n%s\nendstream",
                $img['w'], $img['h'], $img['cs'], $img['filter'], $img['parms'] ? ' /DecodeParms ' . $img['parms'] : '', $smask, strlen($img['data']), $img['data']);
            $xobj[] = "/{$img['name']} {$n} 0 R";
            $n++;
        }
        $res = '/Font << /F1 3 0 R /F2 4 0 R >>' . ($xobj ? ' /XObject << ' . implode(' ', $xobj) . ' >>' : '');
        foreach ($pages as $content) {
            $objs[$n] = sprintf('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %.2F %.2F] /Resources << %s >> /Contents %d 0 R >>', self::W, self::H, $res, $n + 1);
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
