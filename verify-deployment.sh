#!/bin/bash

# ==============================================================================
# Panda EV — Environment Verification Script
# Usage: ./verify-deployment.sh <namespace>
# ==============================================================================

NAMESPACE=$1

if [ -z "$NAMESPACE" ]; then
    echo "Usage: ./verify-deployment.sh <namespace>"
    exit 1
fi

echo "------------------------------------------------------------"
echo "VERIFYING PANDA EV PLATFORM IN NAMESPACE: $NAMESPACE"
echo "------------------------------------------------------------"

# 1. Check Pod Status
echo "1. Checking Pod Status..."
kubectl get pods -n $NAMESPACE

# 2. Check Services
echo -e "\n2. Checking Services..."
kubectl get svc -n $NAMESPACE

# 3. Check RabbitMQ Connectivity (Basic check)
echo -e "\n3. Checking RabbitMQ Connectivity..."
RABBIT_POD=$(kubectl get pods -n $NAMESPACE -l app=panda-rabbitmq -o jsonpath='{.items[0].metadata.name}')
if [ ! -z "$RABBIT_POD" ]; then
    kubectl exec -n $NAMESPACE $RABBIT_POD -- rabbitmq-diagnostics check_running
else
    echo "RabbitMQ pod not found!"
fi

# 4. Check Redis Connectivity
echo -e "\n4. Checking Redis Connectivity..."
REDIS_POD=$(kubectl get pods -n $NAMESPACE -l app=panda-redis -o jsonpath='{.items[0].metadata.name}')
if [ ! -z "$REDIS_POD" ]; then
    echo "Testing Redis from $REDIS_POD..."
    kubectl exec -n $NAMESPACE $REDIS_POD -- nc -zv redis-service 6379
else
    echo "App pod for Redis test not found!"
fi

# 5. Check Cloud SQL Proxy
echo -e "\n5. Checking Cloud SQL Proxy health..."
APP_PODS=$(kubectl get pods -n $NAMESPACE -l app=panda-ocpp-api -o jsonpath='{.items[0].metadata.name}')
if [ ! -z "$APP_PODS" ]; then
    kubectl exec -n $NAMESPACE $APP_PODS -c cloud-sql-proxy -- wget -qO- http://localhost:9090/readiness
fi

echo -e "\nVerification Complete!"
