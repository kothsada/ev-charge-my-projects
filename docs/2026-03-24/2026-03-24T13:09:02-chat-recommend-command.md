CLAUDE.md — panda-ev-notification/CLAUDE.md
  - Full service overview, commands, env vars, architecture, message routing, WebSocket events,
  aggregation pattern, Prisma client import paths, service JWT key setup

  Monorepo updates
  - CLAUDE.md — added notification service row + PANDA_EV_NOTIFICATIONS / DLQ queue entries
  - Memory file — updated service count, added notification service notes and migration

  Remaining to do before production:
  1. Apply the migration: psql "$DATABASE_URL" <
  prisma/migrations/20260322000001_init_notifications/migration.sql && npx prisma migrate resolve
  --applied 20260322000001_init_notifications && npx prisma generate
  2. Seed templates: npx ts-node prisma/seed/seed-templates.ts
  3. Generate service JWT key: openssl genrsa -out keys/notification.pem 2048 && openssl rsa -in
  keys/notification.pem -pubout -out keys/notification.pub
  4. Wire Mobile to publish to PANDA_EV_NOTIFICATIONS instead of calling FCM directly (for full
  decoupling)


  ----------------------------------------------------------------

   ---
  Other ways to save results to .md in the future:

  1. Ask me — "save this as a .md file" and I'll use the Write tool to create it anywhere in the project.
  2. Redirect terminal output:
  curl -s ... | python3 -c "..." > result.md
  3. Export conversation — /export saves to .txt in the project root. To convert to .md:
  cp 2026-03-24-*.txt result.md
  3. The content is already plain text compatible with markdown.
  4. Write inline during a Bash script:
  cat > docs/my-results.md << 'EOF'
  # Results
  ...
  EOF