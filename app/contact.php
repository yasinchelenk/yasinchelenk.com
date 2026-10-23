<?php

declare(strict_types=1);

const CONTACT_SUBJECTS = [
    'proforma'  => 'Proforma DA Talebi',
    'agency'    => 'Acentelik Hizmeti',
    'crew'      => 'Mürettebat Değişimi',
    'supply'    => 'Kumanya / Tedarik',
    'other'     => 'Diğer',
];

function handle_contact(): never
{
    if (!verify_csrf()) {
        flash('errors', ['form' => 'Oturum süresi doldu, lütfen formu tekrar gönderin.']);
        redirect('/iletisim');
    }

    // Basit bot tuzağı: gizli alan doluysa sessizce yoksay.
    if (!empty($_POST['website'])) {
        flash('success', 'Mesajınız alındı.');
        redirect('/iletisim');
    }

    $input = [
        'name'    => trim((string) ($_POST['name'] ?? '')),
        'email'   => trim((string) ($_POST['email'] ?? '')),
        'phone'   => trim((string) ($_POST['phone'] ?? '')),
        'vessel'  => trim((string) ($_POST['vessel'] ?? '')),
        'port'    => trim((string) ($_POST['port'] ?? '')),
        'subject' => (string) ($_POST['subject'] ?? ''),
        'message' => trim((string) ($_POST['message'] ?? '')),
    ];

    $errors = [];
    if (mb_strlen($input['name']) < 2) {
        $errors['name'] = 'Lütfen adınızı yazın.';
    }
    if (!filter_var($input['email'], FILTER_VALIDATE_EMAIL)) {
        $errors['email'] = 'Geçerli bir e-posta adresi girin.';
    }
    if (!array_key_exists($input['subject'], CONTACT_SUBJECTS)) {
        $errors['subject'] = 'Bir konu seçin.';
    }
    if (mb_strlen($input['message']) < 10) {
        $errors['message'] = 'Mesajınız en az 10 karakter olmalı.';
    }
    if (mb_strlen($input['message']) > 5000) {
        $errors['message'] = 'Mesajınız çok uzun.';
    }

    if ($errors) {
        flash('errors', $errors);
        flash('old', $input);
        redirect('/iletisim#form');
    }

    store_message($input);
    send_mail_notification($input);

    flash('success', 'Teşekkürler! Talebiniz operasyon ekibimize iletildi, en kısa sürede dönüş yapacağız.');
    redirect('/iletisim#form');
}

/** @param array<string, string> $input */
function store_message(array $input): void
{
    $record = [
        ...$input,
        'subject_label' => CONTACT_SUBJECTS[$input['subject']],
        'ip'            => $_SERVER['REMOTE_ADDR'] ?? null,
        'created_at'    => date(DATE_ATOM),
    ];

    $file = dirname(__DIR__) . '/storage/messages/' . date('Y-m') . '.jsonl';
    file_put_contents($file, json_encode($record, JSON_UNESCAPED_UNICODE) . PHP_EOL, FILE_APPEND | LOCK_EX);
}

/** @param array<string, string> $input */
function send_mail_notification(array $input): void
{
    if (!config('mail.enabled')) {
        return;
    }

    $body = implode("\n", [
        "Ad Soyad: {$input['name']}",
        "E-posta: {$input['email']}",
        "Telefon: {$input['phone']}",
        "Gemi: {$input['vessel']}",
        "Liman: {$input['port']}",
        'Konu: ' . CONTACT_SUBJECTS[$input['subject']],
        '',
        $input['message'],
    ]);

    $headers = [
        'From'         => 'no-reply@' . parse_url(config('site.url'), PHP_URL_HOST),
        'Reply-To'     => $input['email'],
        'Content-Type' => 'text/plain; charset=UTF-8',
    ];

    @mail(config('mail.to'), '=?UTF-8?B?' . base64_encode('Web Formu: ' . CONTACT_SUBJECTS[$input['subject']]) . '?=', $body, $headers);
}
