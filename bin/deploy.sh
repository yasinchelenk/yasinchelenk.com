#!/bin/bash
# .cpanel.yml tarafından çağrılır: sunucudaki PHP 8.4'ü bulup bin/deploy.php'yi çalıştırır.
set -e
cd "$(dirname "$0")/.."

PHPBIN=/usr/local/bin/php
for p in /opt/cpanel/ea-php84/root/usr/bin/php /opt/alt/php84/usr/bin/php /usr/local/lsws/lsphp84/bin/php; do
    if [ -x "$p" ]; then
        PHPBIN="$p"
        break
    fi
done
echo "Kullanılan PHP = $PHPBIN"

"$PHPBIN" bin/deploy.php "$1"
