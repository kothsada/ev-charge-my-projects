#!/bin/bash

sleep 15
/opt/QtMc/QMS_OCPPJClient &

while true; do
	process=`ps aux | grep QMS_OCPPJClient | grep -v grep`;
        if [ "$process" == "" ];then
                ./QMS_OCPPJClient &
        else
                echo running
        fi
        sleep 30
done

