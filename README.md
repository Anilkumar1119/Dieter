# Gym Member Management

This project uses React, Vite, and Tailwind CSS for the frontend and Express with TypeScript for the backend.

## Step 1 · Project setup

Install Node.js 22.12 or later and npm. From the project directory:

```sh
npm ci
npm run build
```

Run `npm run dev:api` and `npm run dev:web` in separate terminals. Open the URL printed by Vite, usually `http://localhost:5173`. The API defaults to port 4000. Vite forwards `/api` requests to Express during development.

```sh
curl http://localhost:4000/api/health
```

After building, run `npm start` to serve the website and API together at `http://localhost:4000`. Set `PORT` in the process environment to use a different API port. If you change the development API port, also update the proxy target in `web/vite.config.ts`.

## Step 2 · PostgreSQL and Prisma

1. Create an empty PostgreSQL database for development. Use a dedicated development user with access to that database. Prisma's `migrate dev` also needs access to a shadow database when creating migrations.
2. Copy `backend/.env.example` to `backend/.env` and replace `DATABASE_URL` with your PostgreSQL connection string. For a managed database, use the connection settings supplied by your provider.
3. Apply the checked-in migration. For schema changes during development, use `npm run db:migrate` and commit the resulting SQL migration.

```sh
npm ci
npm run db:deploy
```

4. To load demonstration data, set `DEMO_SEED_PASSWORD` in `backend/.env` to a private development password of at least 12 characters and no more than 72 bytes, then run:

```sh
npm run db:seed
```

The seed creates one admin (`+12025550100`), three sample members (`+12025550101` through `+12025550103`), monthly, quarterly and annual plans, and example bills with one cash receipt. It preserves existing demo rows when rerun. The sample phone numbers are for database testing.

The schema stores billing dates as date-only values and fees as integer paise. Each issued bill retains its own plan and price. The database enforces unique phones, billing periods within each membership, receipt numbers, gateway payment and order references, and notification deduplication keys.

For production, provide `DATABASE_URL` through the host's settings and run `npm run db:deploy` before releasing the app. Provision the real admin separately from the demo seed.

## Step 3 · Phone login and account setup

1. Complete Step 2. Set `APP_ORIGIN` in `backend/.env` to the exact browser origin (for example `http://localhost:5173` in Vite development or `http://localhost:4000` when Express serves the built site locally).
2. Generate a random secret with the command below and put the result in `AUTH_SECRET` in `backend/.env`. Keep it private.
3. Set the three Twilio Verify values in `backend/.env` to enable SMS setup and password reset. Configure SMS delivery for your region in the Twilio console. [Twilio Verify setup](https://www.twilio.com/docs/verify/quickstarts/node-express)
4. Sign in at `/admin/login` with the demo admin phone and the password used for the seed. Invite a real test number using **Invite a member**. The invited member opens `/member/setup` to request or enter the code and choose a password. Everyday sign-in is at `/member/login`.
5. Use `/member/reset` for member recovery. Saving a new password revokes existing sessions. Admins use separate sign-in and should be provisioned by an operator.

```sh
node -p "require('node:crypto').randomBytes(32).toString('hex')"
npm run db:deploy
npm run build
```

The admin invitation registers a pending login for the phone number. The admin dashboard also supports adding profiles and assigning plans. The API currently applies per-IP request limits in the running Express instance, plus database-backed verification attempts and resend cooldowns for individual accounts. Configure a validated proxy strategy and shared IP rate limiting if the service is scaled across processes. Set `NODE_ENV=production` and use the HTTPS browser origin on your host.

To provision a standalone admin, provide `ADMIN_BOOTSTRAP_PHONE` in international format and `ADMIN_BOOTSTRAP_PASSWORD` as temporary secrets, then run `npm run auth:create-admin --workspace api` from the project root. The operator is responsible for verifying that the intended administrator controls the supplied number. This command creates a new account and cannot overwrite an existing account.


## Step 4 · Dashboards and member management

- Sign in as an admin to use **Overview**, **Members**, and **Fee plans**. The member list supports name or phone search, sorting, pagination, and archived records.
- Create a fee plan, add a member with that plan, then open the member record to send an SMS setup code. Disabling sign-in revokes active sessions. Changing the phone number requires setup for the new number.
- An admitted member's first bill is due on admission. Assigning a different plan to a billed membership schedules it for the next renewal. Future admissions can be edited until their first bill is issued. The daily job issues subsequent bills.
- Archive members with billing history to stop future renewals while preserving financial records. Records with no issued bills may be deleted.
- The member dashboard shows the signed-in member's profile, plan, next renewal, oldest unpaid bill and paginated bills and payment history. The overview counts members who made a payment in the current Kolkata calendar month and lists due and overdue bills in date order.

## Step 5 · Billing, manual payments and receipts

- From **Overview**, select **Generate due bills**, or run `npm run billing:run` from the project root. The command issues missing periods, including overdue ones, and applies scheduled plan changes at renewal. It is safe to rerun. An operating-system or hosting scheduler can call the same command daily.
- Select **Record payment** beside an open bill on the overview or on the member’s record. Choose cash or bank transfer and enter the received date. The app records the full outstanding balance. Each successful payment creates a unique receipt.
- Admins can open receipts from the member record. Members can access receipts from their own payment history. **Download** saves a printable HTML receipt. From **View receipt**, use your browser’s print menu to save a PDF.

## Daily reminders and notification center

Apply migrations and run `npm run reminders:run` to generate due bills and check for reminders. Members receive a notification three days before a scheduled or issued bill is due and again on the due date while it is open. Admins get one daily digest when open bills are due. Both roles see their own unread count and notification history.

Set `REMINDER_DAYS` to 1–30 to change the reminder lead time. Set `REMINDER_CRON_ENABLED=true` in one always-running API process for the built-in 9:00 a.m. Asia/Kolkata job, or leave it false and have an external scheduler run `npm run reminders:run` daily (03:30 UTC for 09:00 IST). Retry a failed job with the same command. Unique database keys prevent duplicate notifications and billing periods. Review the `JobRun` records for execution status.

## Deploy to Vercel with Neon

Import this repository as a Vercel Express project using the repository root. Set the production environment variables in Vercel:

- `DATABASE_URL` is the pooled Neon connection string. `DIRECT_DATABASE_URL` is the direct connection string for Prisma migrations.
- `AUTH_SECRET` is a random 32-byte value encoded as 64 hex characters. `CRON_SECRET` is a separate random secret used by Vercel Cron.
- The application uses the Vercel production domain as its origin. Set `APP_ORIGIN` to the exact HTTPS origin if you use a different canonical domain.
- Add the three Twilio Verify variables only when enabling live member setup and SMS password resets.

The Vercel build applies checked-in migrations and serves the React site with the Express API on the same origin. The protected Vercel cron runs daily at 03:30 UTC (09:00 IST). `/api/health` checks the web process, and `/api/ready` checks PostgreSQL and the migrated schema. Provision the first admin with `npm run auth:create-admin --workspace api` using the direct Neon connection and temporary admin settings. Keep demo seeds for local development.
