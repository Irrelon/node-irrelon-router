#!/usr/bin/env bash
chmod a+x ./renewCerts.sh
wget https://dl.eff.org/certbot-auto
chmod a+x certbot-auto
./certbot-auto
