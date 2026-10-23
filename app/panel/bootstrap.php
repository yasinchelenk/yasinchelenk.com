<?php

declare(strict_types=1);

require __DIR__ . '/db.php';
require __DIR__ . '/auth.php';
require __DIR__ . '/resources.php';
require __DIR__ . '/api.php';
require __DIR__ . '/proforma.php';
require __DIR__ . '/petitions.php';

function handle_panel(string $path, string $method): never
{
    date_default_timezone_set('Europe/Istanbul');
    header('Cache-Control: no-store');

    if (str_starts_with($path, '/api/')) {
        handle_api($path, $method);
    }

    match (true) {
        $path === '/panel/login' && $method === 'POST' => panel_login_post(),
        $path === '/panel/login'                       => panel_page('login', ['error' => flash('login_error'), 'need_code' => flash('need_code'), 'username' => flash('login_username')]),
        $path === '/panel/logout' && $method === 'POST' => panel_logout(),
        (bool) preg_match('#^/panel/print/(sp1|petition|da)/(\d+)$#', $path, $m) => panel_print($m[1], (int) $m[2]),
        $path === '/panel'                             => panel_page('shell', ['user' => require_user()]),
        default                                        => redirect('/panel'),
    };
}

function panel_page(string $template, array $data = []): never
{
    render("panel/{$template}", $data);
    exit;
}

function panel_login_post(): never
{
    if (!verify_csrf()) {
        flash('login_error', 'Oturum süresi doldu, tekrar deneyin.');
        redirect('/panel/login');
    }

    // Basit kaba kuvvet freni: oturum başına 5 hatalı denemeden sonra 30 sn bekleme
    $fails = $_SESSION['login_fails'] ?? ['count' => 0, 'until' => 0];
    if ($fails['until'] > time()) {
        flash('login_error', 'Çok fazla deneme. Lütfen biraz bekleyin.');
        redirect('/panel/login');
    }

    $username = trim((string) ($_POST['username'] ?? ''));
    $result = attempt_login($username, (string) ($_POST['password'] ?? ''), $_POST['code'] ?? null);

    if ($result === true) {
        unset($_SESSION['login_fails']);
        redirect('/panel');
    }

    if ($result === 'totp') {
        flash('need_code', true);
        flash('login_username', $username);
        flash('login_error', 'İki adımlı doğrulama kodunu girin.');
        redirect('/panel/login');
    }

    $fails['count']++;
    if ($fails['count'] >= 5) {
        $fails = ['count' => 0, 'until' => time() + 30];
    }
    $_SESSION['login_fails'] = $fails;
    flash('login_error', $result);
    flash('login_username', $username);
    flash('need_code', !empty($_POST['code']));
    redirect('/panel/login');
}

function panel_logout(): never
{
    if (verify_csrf()) {
        unset($_SESSION['panel_user']);
        session_regenerate_id(true);
    }
    redirect('/panel/login');
}

function panel_print(string $kind, int $id): never
{
    require_user();

    $data = match ($kind) {
        'sp1' => (function () use ($id) {
            $position = fetch_record('positions', $id) ?? redirect('/panel');
            return ['position' => $position, 'vessel' => row('SELECT * FROM vessels WHERE id = ?', [$position['vessel_id']])];
        })(),
        'petition' => (function () use ($id) {
            $petition = fetch_record('petitions', $id) ?? redirect('/panel');
            $data = json_decode((string) $petition['data'], true);
            if (!$data) {
                return ['petition' => $petition]; // eski düz metin dilekçeler
            }
            $docs = petition_documents($data)['docs'];
            if (!empty($_GET['doc'])) {
                $docs = array_values(array_filter($docs, fn($d) => $d['key'] === $_GET['doc']));
            }
            echo document_page($docs, (string) $petition['title'], toolbar: true);
            exit;
        })(),
        'da'       => da_detail($id),
    };

    panel_page("print/{$kind}", $data);
}
