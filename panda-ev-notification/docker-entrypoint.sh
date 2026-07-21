#!/bin/sh
set -e

# Prisma 7's env() reads from .env file, not process.env.
# Write DATABASE_URL from the container environment into .env
printf 'DATABASE_URL=%s\n' "$DATABASE_URL" > /app/.env

echo "Waiting for database (sidecar proxy) to be ready on 127.0.0.1:5432..."
max_retries=30
count=0
until nc -z 127.0.0.1 5432 || [ $count -eq $max_retries ]; do
  sleep 1
  count=$((count + 1))
done

if [ $count -eq $max_retries ]; then
  echo "Database not reachable after 30 seconds. Proceeding anyway but migrations may fail."
else
  echo "Database port is open"
fi

echo "Running database migrations..."
npx prisma migrate deploy --schema=./prisma/schema.prisma
echo "Migrations applied"

echo "Starting Panda EV Notification Service..."
exec node dist/src/main
