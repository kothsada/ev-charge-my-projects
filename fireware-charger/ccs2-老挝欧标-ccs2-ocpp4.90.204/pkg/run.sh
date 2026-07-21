#!/bin/bash

pkill -f QMC021

sleep 2

if pgrep -f QMC021 > /dev/null; then
    pkill -9 -f QMC021
fi
sleep 1




exec /opt/QtMc/QMC021 "$@"

chown -R xrd:xrd /etc/QMC021/
chmod -R 777 /etc/QMC021/

