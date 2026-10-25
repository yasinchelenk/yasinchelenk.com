<?php

declare(strict_types=1);

const CONTACT_SUBJECTS = [
    'job'        => ['tr' => 'İş fırsatı', 'en' => 'Job opportunity'],
    'collab'     => ['tr' => 'İş birliği', 'en' => 'Collaboration'],
    'operations' => ['tr' => 'Acentelik / operasyon sorusu', 'en' => 'Agency / operations question'],
    'other'      => ['tr' => 'Diğer', 'en' => 'Other'],
];

const CONTACT_MESSAGES = [
    'expired' => ['tr' => 'Oturum süresi doldu, lütfen formu tekrar gönderin.', 'en' => 'Your session expired, please submit the form again.'],
    'name'    => ['tr' => 'Lütfen adınızı yazın.', 'en' => 'Please enter your name.'],
    'email'   => ['tr' => 'Geçerli bir e-posta adresi girin.', 'en' => 'Please enter a valid email address.'],
    'subject' => ['tr' => 'Bir konu seçin.', 'en' => 'Please choose a subject.'],
    'short'   => ['tr' => 'Mesajınız en az 10 karakter olmalı.', 'en' => 'Your message should be at least 10 characters.'],
    'long'    => ['tr' => 'Mesajınız çok uzun.', 'en' => 'Your message is too long.'],
    'success' => ['tr' => 'Teşekkürler! Mesajınız bana ulaştı, en kısa sürede dönüş yapacağım.', 'en' => 'Thank you! Your message has reached me and I will get back to you soon.'],
];

function handle_contact(): never
{
    $back = home_url() . '#contact';

    if (!verify_csrf()) {
        flash('errors', ['form' => t(CONTACT_MESSAGES['expired'])]);
        redirect($back);
    }

    // Basit bot tuzağı: gizli alan doluysa sessizce yoksay.
    if (!empty($_POST['website'])) {
        flash('success', t(CONTACT_MESSAGES['success']));
        redirect($back);
    }

    $input = [
        'name'    => trim((string) ($_POST['name'] ?? '')),
        'email'   => trim((string) ($_POST['email'] ?? '')),
        'company' => trim((string) ($_POST['company'] ?? '')),
        'subject' => (string) ($_POST['subject'] ?? ''),
        'message' => trim((string) ($_POST['message'] ?? '')),
    ];

    $errors = [];
    if (mb_strlen($input['name']) < 2) {
        $errors['name'] = t(CONTACT_MESSAGES['name']);
    }
    if (!filter_var($input['email'], FILTER_VALIDATE_EMAIL)) {
        $errors['email'] = t(CONTACT_MESSAGES['email']);
    }
    if (!array_key_exists($input['subject'], CONTACT_SUBJECTS)) {
        $errors['subject'] = t(CONTACT_MESSAGES['subject']);
    }
    if (mb_strlen($input['message']) < 10) {
        $errors['message'] = t(CONTACT_MESSAGES['short']);
    }
    if (mb_strlen($input['message']) > 5000) {
        $errors['message'] = t(CONTACT_MESSAGES['long']);
    }

    if ($errors) {
        flash('errors', $errors);
        flash('old', $input);
        redirect($back);
    }

    store_message($input);
    send_mail_notification($input);

    flash('success', t(CONTACT_MESSAGES['success']));
    redirect($back);
}

/** @param array<string, string> $input */
function store_message(array $input): void
{
    $record = [
        ...$input,
        'subject_label' => CONTACT_SUBJECTS[$input['subject']]['tr'],
        'lang'          => lang(),
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

    $subject = CONTACT_SUBJECTS[$input['subject']]['tr'];
    $body = implode("\n", [
        "Ad Soyad: {$input['name']}",
        "E-posta: {$input['email']}",
        "Şirket: {$input['company']}",
        "Konu: {$subject}",
        'Dil: ' . lang(),
        '',
        $input['message'],
    ]);

    $headers = [
        'From'         => 'no-reply@' . parse_url(config('site.url'), PHP_URL_HOST),
        'Reply-To'     => $input['email'],
        'Content-Type' => 'text/plain; charset=UTF-8',
    ];

    @mail(config('mail.to'), '=?UTF-8?B?' . base64_encode("yasinchelenk.com: {$subject}") . '?=', $body, $headers);
}
