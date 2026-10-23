<?php /** @var string $doc_title */ /** @var string $content */ ?>
<!doctype html>
<html lang="tr">
<head>
    <meta charset="utf-8">
    <title><?= e($doc_title) ?></title>
    <style>
        @page { size: A4; margin: 18mm; }
        body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 12.5px; margin: 0; }
        .sheet { max-width: 180mm; margin: 0 auto; padding: 10mm 0; }
        .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0a2540; padding-bottom: 8px; margin-bottom: 16px; }
        .head h1 { font-size: 18px; margin: 0; color: #0a2540; }
        .head small { color: #555; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
        th, td { border: 1px solid #999; padding: 5px 7px; text-align: left; vertical-align: top; }
        th { background: #eef2f6; width: 34%; }
        .num { text-align: right; white-space: nowrap; }
        .body { white-space: pre-wrap; line-height: 1.7; font-size: 13.5px; }
        .sign { margin-top: 40px; display: flex; justify-content: space-between; }
        .tools { position: fixed; top: 10px; right: 10px; }
        .tools button { padding: 8px 14px; font-size: 14px; cursor: pointer; }
        @media print { .tools { display: none; } .sheet { padding: 0; } }
    </style>
</head>
<body>
<div class="tools"><button onclick="print()">Yazdır / PDF kaydet</button></div>
<div class="sheet"><?= $content ?></div>
</body>
</html>
