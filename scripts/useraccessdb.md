Production instance:
# system
cloud-sql-proxy --address 0.0.0.0 --port 5433 pandaev:asia-southeast1:panda-ev-instance-system-db-a2
### user : panda_admin_user
### password : Panda>2026>Admin1234567890>
### instancedb : panda_ev_system
### schema : panda_ev_system
### port : 5433

# mobile
cloud-sql-proxy --address 0.0.0.0 --port 5434 pandaev:asia-southeast1:panda-ev-instance-mobile-db-a2
### user : panda_mobile_user
### password : Panda>2026>WriteMobile1234567890>
### instancedb : panda_ev_mobile
### schema : panda_ev_mobile
### port : 5434

# mobile replica
## user : panda_mobile_reader
## password : Panda>2026>ReadMobile1234567890>


# notifcation + sms = schema panda_ev_noti
# gateway payment = schema panda_ev_gateway
cloud-sql-proxy --address 0.0.0.0 --port 5435 pandaev:asia-southeast1:panda-ev-instance-core-db-a2
### user : panda_noti_user
### password : Panda>2026>ReadNotification1234567890>
### instancedb : panda_ev_core
### schema : panda_ev_noti
### port : 5435

### user : panda_gateway_user
### password : Panda>2026>WriteGateway1234567890>
### instancedb : panda_ev_core
### schema : panda_ev_gateway
### port : 5435

# ocpp
cloud-sql-proxy --address 0.0.0.0 --port 5436 pandaev:asia-southeast1:panda-ev-instance-ocpp-db-a2
### user : panda_ocpp_user
### password : Panda>2026>WriteOcpp1234567890>
### instancedb : panda_ev_ocpp
### schema : panda_ev_ocpp
### port : 5436

# ocpp replica
## user : panda_ocpp_reader
## password : Panda>2026>ReadOcpp1234567890>