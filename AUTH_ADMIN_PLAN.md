# Authentication and administration rollout

Status: implemented. The sections below match the reviewable commit boundaries.

The feature is delivered in small, independently reviewable commits. Backend and
frontend images remain independently deployable; compatibility is governed by the
HTTP API contract, not by matching image revisions.

## 1. Authentication foundation

- Move shared PostgreSQL access and migrations into a database module.
- Add clinics, users, permissions and server-side sessions.
- Add email/password login, logout and current-session endpoints.
- Store only salted, memory-hard password hashes and hashed session tokens.
- Require authentication for request APIs and scope requests to the current user.

## 2. Administration backend

- Add clinic creation/listing.
- Add user creation/listing, permissions, blocking and password regeneration.
- Return a generated password only in the create/regenerate response.
- Add a one-time CLI command for creating the first administrator.
- Enforce administrator permissions in the backend.

## 3. React authentication and administration

- Add history-based routes for `/login`, `/requests`, `/profile` and `/admin`.
- Add a session provider and protected application routes.
- Add optional profile fields: full name, position and specialization.
- Add clinic and user administration screens with one-time password copy UI.

## 4. Nginx network boundary

- Restrict `/admin` and `/api/admin` with a separately mounted allow-list.
- Keep the local-stack allow-list explicitly unrestricted.
- Document a production/VPN CIDR example; network access is enforced only by Nginx.

## 5. Verification and operations

- Cover password, session, authorization and one-time-secret behaviour with tests.
- Run backend, frontend browser and Nginx smoke suites.
- Document local bootstrap, login and production configuration.
