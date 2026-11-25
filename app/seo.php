<?php

declare(strict_types=1);

/** robots.txt: adresler config'teki site.url'den; yalnızca Chartering Desk kurulumunda hiçbir sayfa taranmaz. */
function robots_txt(): never
{
    header('Content-Type: text/plain; charset=utf-8');
    if (chartering_instance()) {
        exit("User-agent: *\nDisallow: /\n");
    }
    $url = rtrim((string) config('site.url'), '/');
    exit("User-agent: *\nDisallow: /panel\nDisallow: /api/\nDisallow: /admin\n\nSitemap: {$url}/sitemap.xml\n");
}

/** sitemap.xml: kişisel sitenin her dil sürümü, karşılıklı hreflang bağlantılarıyla. */
function sitemap_xml(): never
{
    header('Content-Type: application/xml; charset=utf-8');
    $url = rtrim((string) config('site.url'), '/');
    $alternates = '';
    foreach (config('site.langs') as $l) {
        $alternates .= '        <xhtml:link rel="alternate" hreflang="' . e($l) . '" href="' . e($url . home_url($l)) . "\"/>\n";
    }
    $out = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
        . "<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\" xmlns:xhtml=\"http://www.w3.org/1999/xhtml\">\n";
    foreach (config('site.langs') as $l) {
        $out .= "    <url>\n        <loc>" . e($url . home_url($l)) . "</loc>\n{$alternates}    </url>\n";
    }
    exit($out . "</urlset>\n");
}
