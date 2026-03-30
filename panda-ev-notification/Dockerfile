# -----------------------------
# 1. Builder Stage
# -----------------------------
FROM node:22-alpine AS builder

WORKDIR /app

RUN apk add --no-cache openssl

COPY package*.json ./
COPY prisma ./prisma/
COPY prisma.config.ts ./

RUN npm ci

COPY . .

# Generate Prisma client (dummy DATABASE_URL — not needed at build time)
RUN echo "DATABASE_URL=postgresql://dummy:dummy@localhost:5432/dummy" > .env && npx prisma generate && rm -f .env

RUN npm run build

# -----------------------------
# 2. Production Stage
# -----------------------------
FROM node:22-alpine AS runner

WORKDIR /app

RUN apk add --no-cache openssl netcat-openbsd

ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/generated ./generated
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts

COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

EXPOSE 5001

CMD ["./docker-entrypoint.sh"]
