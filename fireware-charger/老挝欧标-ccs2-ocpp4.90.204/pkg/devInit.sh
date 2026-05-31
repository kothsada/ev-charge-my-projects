#!/bin/bash

UPDATEFILE="/opt/QtMc/pkg.tar.gz"
CACHE_DIR="/opt/QtMc/Cache"
if [ -f "$UPDATEFILE" ]; then
    tar -zxf "$UPDATEFILE" -C /opt/QtMc/
    rm -f "$UPDATEFILE"
    echo "Operation completed successfully."
fi

if [ -d "$CACHE_DIR" ]; then
    rm -rf "$CACHE_DIR"/*
fi


sleep 1
xrd_reset_tpcfg 0 x14 /etc/GT9110_R7_V00_PGA6_1024X600.cfg


chown -R xrd:xrd /etc/QMC021/
chmod -R 777 /etc/QMC021/

while true; do
        sleep 10
done

