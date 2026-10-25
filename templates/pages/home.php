<?php
/** @var array<string, string> $errors */
/** @var array<string, string> $old */
/** @var string|null $success */

// Bölümler Site Yönetimi → Site yapısı'ndaki sırayla çizilir; arka planlar sırayla açık/gri gider.
$sections = array_values(array_filter(content('sections'), fn($s) => $s['visible']));
$types = array_column($sections, 'type');
$alt = true;

foreach ($sections as $i => $section) {
    if (!in_array($section['type'], ['hero', 'stats'], true)) {
        $alt = !$alt;
    }
    render("sections/{$section['type']}", [
        'section'     => $section,
        'alt'         => $alt,
        'overlap'     => ($sections[$i - 1]['type'] ?? null) === 'hero',
        'has_contact' => in_array('contact', $types, true),
        'errors'      => $errors,
        'old'         => $old,
        'success'     => $success,
    ]);
}
