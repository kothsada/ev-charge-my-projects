#!/bin/bash

export net_connect_timout=1
export net_model_restart=1

function check_network_ping() {
	echo "ping..."
	ping -c 1 139.224.41.205 > /dev/null 2>&1
	if [ $? -eq 0 ]; then
		echo "ping : net ok"
		return 0
	else
		echo "ping : net error"
		return 1
	fi
}

function check_netmodel_restart()
{
    echo "check_netmodel_restart: ${1}"
    if [ ${net_model_restart} -gt 5 ]; then
        echo "Restart EC200M! dev= ${1} " >> /var/log/net_4g.log
        net_model_restart=1
	echo -e "AT+QNETDEVCTL=3,1,1" > ${1}
        sleep 10
	echo -e "AT+CFUN=1,1\r" > ${1}
        sleep 2
    fi
}

function check_net_connect_timout()
{
    echo "check_net_connect_timout: ${1}"
    if [ ${net_connect_timout} -gt 30 ]; then
        echo -e "AT+CFUN=1,1\r" > ${1}
        echo "check_net_connect_timout() executed successfully dev= ${1} >>> system reboot" >> /var/log/net_4g.log
        sleep 10
        reboot
    fi
}


timedatectl set-ntp false

while true; do

    modem_path=$(mmcli -L | grep -oP '/org/freedesktop/ModemManager1/Modem/\d+')
    if [ -n "$modem_path" ]; then
        mmcli_output=$(mmcli -m "$modem_path")
        at_port=$(echo "$mmcli_output" | grep -oP '(?<=primary port: )\w+')
        net_port=$(echo "$mmcli_output" | grep -oP '(?<=ports: )\w+ \(\w+\), \w+ \(\w+\)' | grep -oP '\w+(?= \(net\))')

	main_at_port=/dev/${at_port}
        echo "at_port:${main_at_port}"
        echo "net_port:$net_port"

	check_network_ping
        if [ $? -eq 1 ];then
   	    echo "Network error!"
	    echo "socating... dev=/dev/$at_port"
	    echo -e "AT+QNETDEVCTL=3,1,1\r" > ${main_at_port}
	    sleep 10
            echo -e "AT+CFUN=1,1\r" > ${main_at_port}
            let net_connect_timout++
            let net_model_restart++
            echo "net connect timout=${net_connect_timout}"

            check_netmodel_restart ${main_at_port}
            check_net_connect_timout ${main_at_port}
            echo "Net: Disconnected" > /var/log/4g_state.log
        else
            net_connect_timout=1
            net_model_restart=1
            echo "Net: Connected" > /var/log/4g_state.log
        fi
	echo "4GModel is Plugged" > /var/log/4g_device
    else
        echo "4GModel is not Plugged!" > /var/log/4g_device
    fi
    sleep 10
done

