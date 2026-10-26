<?php

declare(strict_types=1);

/**
 * Küçük SMTP istemcisi (STARTTLS / SSL, AUTH LOGIN, ekler). Ayarlar config('smtp') — .env'den:
 * SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE (tls|ssl|none), MAIL_FROM (gönderen), MAIL_ACCOUNT (armatör maili gönderen).
 * Ayar yoksa mail gönderilmez; storage/outbox altına .eml olarak yazılır (spec plan kararı).
 */
function smtp_config(): array
{
    return array_merge(['host' => '', 'port' => 587, 'user' => '', 'pass' => '', 'secure' => 'tls', 'from' => '', 'account' => ''], (array) config('smtp', []));
}

/** Eksik ayar adları ($account: armatör maili için account@ adresi de gerekir) */
function smtp_missing(bool $account = false): array
{
    $c = smtp_config();
    if (!empty($c['outbox'])) {
        return [];                                  // geliştirme modu: mailler storage/outbox'a yazılır
    }
    $miss = [];
    foreach (['host' => 'SMTP_HOST', 'user' => 'SMTP_USER', 'pass' => 'SMTP_PASS'] as $k => $env) {
        if (($c[$k] ?? '') === '') {
            $miss[] = $env;
        }
    }
    if ($account && ($c['account'] ?? '') === '') {
        $miss[] = 'MAIL_ACCOUNT';
    }

    return $miss;
}

function mail_encode_header(string $s): string
{
    return preg_match('/[^\x20-\x7E]/', $s) ? '=?UTF-8?B?' . base64_encode($s) . '?=' : $s;
}

/** "Ad <adres>; adres2, …" → adresler @return list<string> */
function mail_split_addresses(?string $s): array
{
    $out = [];
    foreach (preg_split('/[;,]+/', (string) $s) as $part) {
        $part = trim($part);
        if (preg_match('/<([^<>\s]+@[^<>\s]+)>/', $part, $m)) {
            $part = $m[1];
        }
        foreach (preg_split('/\s+/', $part) as $a) {
            if (filter_var($a, FILTER_VALIDATE_EMAIL)) {
                $out[] = $a;
            }
        }
    }

    return array_values(array_unique($out));
}

/** Gönderen: MAIL_FROM (ya da Firma Ayarları → Gönderen e-posta), firma adıyla */
function mail_from(): string
{
    $addr = smtp_config()['from'] ?: (string) setting('firma_email', '');
    $name = (string) (setting('firma_ad') ?: '');

    return $name !== '' ? mail_encode_header($name) . " <{$addr}>" : $addr;
}

function smtp_status(): array
{
    $miss = smtp_missing();
    $from = smtp_config()['from'] ?: (string) setting('firma_email', '');

    return ['hazir' => !$miss && $from !== '', 'eksik' => $from === '' ? [...$miss, 'MAIL_FROM'] : $miss, 'gonderen' => $from, 'outbox' => !empty(smtp_config()['outbox'])];
}

/**
 * @param array<int, array{name: string, data: string, type?: string}> $attachments
 * @param array<int, array{cid: string, data: string, type: string}> $inline
 */
function mail_build(string $from, array $to, array $cc, string $subject, string $html, array $attachments = [], array $inline = []): string
{
    $b1 = 'b1_' . bin2hex(random_bytes(8));
    $b2 = 'b2_' . bin2hex(random_bytes(8));
    $b3 = 'b3_' . bin2hex(random_bytes(8));
    $h = [
        'From: ' . $from,
        'To: ' . implode(', ', $to),
        $cc ? 'Cc: ' . implode(', ', $cc) : null,
        'Subject: ' . mail_encode_header($subject),
        'Date: ' . date('r'),
        'Message-ID: <' . bin2hex(random_bytes(12)) . '@' . (explode('@', $from)[1] ?? 'localhost') . '>',
        'MIME-Version: 1.0',
        "Content-Type: multipart/mixed; boundary=\"{$b1}\"",
    ];
    $text = trim(html_entity_decode(strip_tags(preg_replace('#<br\s*/?>|</p>|</tr>#i', "\n", $html)), ENT_QUOTES, 'UTF-8'));
    $body = "--{$b1}\r\nContent-Type: multipart/related; boundary=\"{$b2}\"\r\n\r\n"
        . "--{$b2}\r\nContent-Type: multipart/alternative; boundary=\"{$b3}\"\r\n\r\n"
        . "--{$b3}\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" . chunk_split(base64_encode($text)) . "\r\n"
        . "--{$b3}\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" . chunk_split(base64_encode($html)) . "\r\n"
        . "--{$b3}--\r\n";
    foreach ($inline as $img) {
        $body .= "--{$b2}\r\nContent-Type: {$img['type']}\r\nContent-Transfer-Encoding: base64\r\nContent-ID: <{$img['cid']}>\r\nContent-Disposition: inline\r\n\r\n" . chunk_split(base64_encode($img['data'])) . "\r\n";
    }
    $body .= "--{$b2}--\r\n";
    foreach ($attachments as $a) {
        $name = mail_encode_header($a['name']);
        $body .= "--{$b1}\r\nContent-Type: " . ($a['type'] ?? 'application/octet-stream') . "; name=\"{$name}\"\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename=\"{$name}\"\r\n\r\n"
            . chunk_split(base64_encode($a['data'])) . "\r\n";
    }
    $body .= "--{$b1}--\r\n";

    return implode("\r\n", array_filter($h)) . "\r\n\r\n" . $body;
}

/**
 * Gönderir. SMTP ayarı yoksa storage/outbox'a yazar ve ['outbox' => dosya] döner.
 * @return array{ok: bool, outbox?: string, error?: string}
 */
function mail_send(string $from, array $to, array $cc, string $subject, string $html, array $attachments = [], array $inline = []): array
{
    $to || throw new RuntimeException('Alıcı adresi yok.');
    $raw = mail_build($from, $to, $cc, $subject, $html, $attachments, $inline);
    if (smtp_missing() || !empty(smtp_config()['outbox'])) {
        $dir = panel_storage('outbox');
        is_dir($dir) || mkdir($dir, 0775, true);
        $file = $dir . '/' . date('Ymd-His') . '-' . substr(preg_replace('/[^a-z0-9]+/i', '-', $subject), 0, 60) . '.eml';
        file_put_contents($file, $raw);
        return ['ok' => true, 'outbox' => basename($file)];
    }
    $c = smtp_config();
    try {
        smtp_deliver($c, $from, [...$to, ...$cc], $raw);
        return ['ok' => true];
    } catch (Throwable $e) {
        return ['ok' => false, 'error' => $e->getMessage()];
    }
}

function smtp_deliver(array $c, string $from, array $rcpt, string $raw): void
{
    $host = ($c['secure'] === 'ssl' ? 'ssl://' : '') . $c['host'];
    $fp = @stream_socket_client($host . ':' . (int) $c['port'], $errno, $errstr, 15);
    if (!$fp) {
        throw new RuntimeException("SMTP bağlantısı kurulamadı: {$errstr}");
    }
    stream_set_timeout($fp, 20);
    $read = function () use ($fp): string {
        $out = '';
        while (($line = fgets($fp, 1024)) !== false) {
            $out .= $line;
            if (strlen($line) < 4 || $line[3] === ' ') {
                break;
            }
        }
        return $out;
    };
    $cmd = function (string $s, array $ok) use ($fp, $read): string {
        fwrite($fp, $s . "\r\n");
        $r = $read();
        if (!in_array((int) substr($r, 0, 3), $ok, true)) {
            throw new RuntimeException('SMTP: ' . trim($r));
        }
        return $r;
    };
    $read();
    $ehlo = 'EHLO ' . (gethostname() ?: 'localhost');
    $cmd($ehlo, [250]);
    if ($c['secure'] === 'tls') {
        $cmd('STARTTLS', [220]);
        if (!stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT | STREAM_CRYPTO_METHOD_TLSv1_3_CLIENT)) {
            throw new RuntimeException('SMTP TLS başlatılamadı.');
        }
        $cmd($ehlo, [250]);
    }
    if ($c['user'] !== '') {
        $cmd('AUTH LOGIN', [334]);
        $cmd(base64_encode($c['user']), [334]);
        $cmd(base64_encode($c['pass']), [235]);
    }
    preg_match('/<?([^<>\s]+@[^<>\s]+)>?$/', $from, $m);
    $cmd('MAIL FROM:<' . ($m[1] ?? $from) . '>', [250]);
    foreach ($rcpt as $r) {
        $cmd("RCPT TO:<{$r}>", [250, 251]);
    }
    $cmd('DATA', [354]);
    $cmd(preg_replace('/^\./m', '..', $raw) . "\r\n.", [250]);
    fwrite($fp, "QUIT\r\n");
    fclose($fp);
}
