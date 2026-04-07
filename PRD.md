# PRD: Multi-Tenant Course Platform MVP

## Problem Statement

Course creators pay $150+/month for platforms like Thinkific to host and sell their courses. These platforms charge high fees for what is fundamentally serving video, handling payments, and tracking progress. A self-hosted alternative at ~$12-25/month total infrastructure cost would save creators significant money — but no good multi-tenant, commercially viable alternative exists in the TypeScript ecosystem.

The goal is to build a commercial SaaS course platform where instructors sign up, create their own branded school (subdomain), build courses, and sell them to students — with the platform taking an application fee on transactions.

## Solution

A multi-tenant course platform built with TanStack Start + VitePlus, PostgreSQL, Stripe Connect, and Bunny/Cloudflare Stream. Each instructor gets a subdomain (`school.platform.com`) with their own storefront, course builder, and student base. Students create accounts per-tenant and purchase courses via Stripe (instructor is merchant of record). The platform monetizes through Stripe Connect application fees and tiered subscription plans for instructors.

Key technology choices:
- **TanStack Start** as application framework, **VitePlus** as build toolchain
- **PostgreSQL + Drizzle ORM** with shared-database multi-tenancy (`tenant_id` column)
- **Better Auth** for authentication (per-tenant user pools)
- **Stripe Connect (Standard)** with instructor as merchant of record
- **Bunny Stream / Cloudflare Stream** for video hosting (behind abstraction)
- **Resend + React Email** for transactional emails
- **Postgres-based job queue** (pgboss or Graphile Worker) for background processing
- **Hetzner VPS + Coolify + Docker** for deployment
- **shadcn/ui + Base UI** for components, **Tailwind CSS** for styling

## User Stories

### Instructor (Tenant Owner)

1. As an instructor, I want to sign up and create a school so that I have my own branded space to sell courses.
2. As an instructor, I want my school available at a subdomain (e.g., `myschool.platform.com`) so that students can find me.
3. As an instructor, I want to connect my Stripe account via Stripe Connect so that I can receive payments directly.
4. As an instructor, I want to create a course with a title, description, thumbnail, and price so that I can offer it for sale.
5. As an instructor, I want to organize my course into modules so that content is structured logically for students.
6. As an instructor, I want to create video lessons by uploading videos so that students can watch course content.
7. As an instructor, I want to create text/article lessons using a rich text editor so that I can provide written content.
8. As an instructor, I want to attach downloadable files (PDFs, worksheets) to lessons so that students get supplementary materials.
9. As an instructor, I want to create quiz lessons so that I can assess student understanding.
10. As an instructor, I want to reorder modules and lessons so that I can control the curriculum flow.
11. As an instructor, I want to set a course as draft or published so that I control when content goes live.
12. As an instructor, I want to offer courses as one-time purchases so that students pay once for lifetime access.
13. As an instructor, I want to offer a subscription model (monthly access to all content) as an alternative pricing option.
14. As an instructor, I want to support both one-time and subscription models simultaneously so that students can choose.
15. As an instructor, I want to see a dashboard with my courses, student count, and revenue so that I can track my business.
16. As an instructor, I want to issue certificates of completion so that students have proof of finishing a course.
17. As an instructor, I want my storefront page to display my published courses with thumbnails and prices so that students can browse and buy.

### Student

18. As a student, I want to browse an instructor's storefront and see available courses so that I can decide what to buy.
19. As a student, I want to view a course detail page with description, curriculum outline, and price so that I can make an informed purchase decision.
20. As a student, I want to register an account on an instructor's school so that I can enroll in courses.
21. As a student, I want to log in with email/password or social login (Google) so that access is convenient.
22. As a student, I want to purchase a course via Stripe checkout so that I can access the content.
23. As a student, I want to subscribe monthly for access to all of an instructor's content so that I get ongoing value.
24. As a student, I want a dashboard showing my enrolled courses and progress so that I can pick up where I left off.
25. As a student, I want to watch video lessons with protected playback so that content loads reliably with adaptive bitrate.
26. As a student, I want to read text/article lessons so that I can learn from written content.
27. As a student, I want to download attached files so that I have supplementary materials.
28. As a student, I want to take quizzes so that I can test my understanding.
29. As a student, I want my progress tracked automatically (lesson completion) so that I know what I've finished.
30. As a student, I want to receive a certificate when I complete a course so that I have proof of completion.
31. As a student, I want to receive email confirmations for purchases and enrollment so that I have records.

### Platform Admin

32. As a platform admin, I want to manage tenants (schools) so that I can handle support and moderation.
33. As a platform admin, I want to configure plan tiers with feature limits so that I can monetize the platform.
34. As a platform admin, I want to set application fee percentages per plan tier so that the platform generates revenue.
35. As a platform admin, I want to view platform-wide metrics (total tenants, students, revenue) so that I can track growth.

## Implementation Decisions

### Module 1: Tenant Management
- Shared PostgreSQL database with `tenant_id` column on all tenant-scoped tables (not schema-per-tenant or database-per-tenant).
- Subdomain resolution middleware that extracts tenant from the request host and injects tenant context into every request.
- Tenants table stores: subdomain, name, settings, plan tier, Stripe Connect account ID.
- Plan/feature-limit enforcement checked at the middleware or service layer (e.g., max courses, max students).
- Custom domain support is NOT in MVP — planned as a paid tier feature for later.

### Module 2: Auth (Better Auth)
- Better Auth configured with Drizzle adapter and PostgreSQL.
- Per-tenant user isolation: users are scoped to a tenant. Same email can exist on different tenants.
- Roles: platform_admin (global), tenant_owner, tenant_admin, student (all tenant-scoped).
- Email/password + Google social login for MVP.
- Session management scoped to tenant subdomain.

### Module 3: Course Builder (Admin Dashboard)
- Course → Module → Lesson three-level hierarchy.
- Courses have: title, description, slug, thumbnail, price, pricing_model (one_time | subscription | both), status (draft | published), tenant_id.
- Modules have: title, position (for ordering), course_id.
- Lessons have: title, type (video | text | quiz | file), content (JSON or markdown), position, module_id.
- Video upload: direct-to-provider upload using signed upload URLs (browser uploads directly to Bunny/Cloudflare, not through the server). Callback webhook updates lesson with video ID.
- Text editor: basic rich text (bold, italic, headings, links, code blocks). Editor choice deferred (Tiptap or Plate).
- File uploads: to S3-compatible storage (provider TBD), signed download URLs for students.
- Reordering via drag-and-drop or up/down controls.

### Module 4: Storefront (Student-Facing)
- Tenant storefront: server-rendered page at tenant subdomain root, lists published courses.
- Course detail page: server-rendered, public, shows description, curriculum outline (module/lesson titles only), instructor info, price, and purchase CTA.
- Student dashboard: enrolled courses with progress bars, continue-where-you-left-off.
- Lesson player: video player with signed/expiring URLs, text renderer, file download links, quiz interface.
- Progress tracking: mark lessons complete (explicit button), auto-derive module and course completion from lesson progress.

### Module 5: Payments (Stripe Connect)
- Stripe Connect Standard accounts — instructor completes OAuth onboarding flow.
- Checkout: Stripe Checkout Sessions with application fee amount.
- One-time purchases: single Checkout Session, enrollment record created on `checkout.session.completed` webhook.
- Subscriptions: Stripe Checkout in subscription mode, access managed via `customer.subscription.created/updated/deleted` webhooks.
- Webhook handler as REST endpoint (not server function) — verifies Stripe signature, dispatches to background job queue.
- Refund handling: on `charge.refunded`, revoke enrollment.

### Module 6: Notifications (Resend)
- Thin email service wrapping Resend API.
- React Email templates for: welcome, password reset, purchase confirmation, enrollment confirmation, certificate delivery.
- Emails dispatched via background job queue (not sent synchronously in request handlers).

### Module 7: Background Jobs (Postgres Queue)
- pgboss or Graphile Worker running in the same Node process (or as a separate worker process).
- Job types: send_email, process_stripe_webhook, generate_certificate, process_video_callback.
- Failed jobs retry with exponential backoff.

### Module 8: Database Schema (Drizzle + PostgreSQL)
- Core tables: tenants, users, sessions, accounts (Better Auth), roles, courses, modules, lessons, enrollments, lesson_progress, payments, subscriptions, certificates, plans.
- All tenant-scoped tables include `tenant_id` with a foreign key to tenants.
- Drizzle ORM with migration files managed via `drizzle-kit`.
- Indexes on: `tenant_id` (all tables), `user_id + course_id` (enrollments), `user_id + lesson_id` (progress).

### API Layer
- TanStack Start server functions for all frontend ↔ backend communication (type-safe, colocated).
- REST endpoints only for: Stripe webhooks, video provider webhooks.
- No tRPC — server functions already provide end-to-end type safety.

### Video Protection
- Signed URLs with short expiry windows (e.g., 4 hours).
- URLs generated server-side per lesson view request.
- No DRM (Widevine) — signed URLs prevent casual sharing, accepted trade-off.
- Video provider abstracted behind an interface to allow swapping Bunny ↔ Cloudflare.

## Testing Decisions

Good tests for this project should:
- Test external behavior through public interfaces, not implementation details.
- Use a real PostgreSQL database (not mocks) for integration tests — mock/prod divergence has caused issues in similar projects.
- Test the critical money and access paths end-to-end.

### Modules to test:

**Auth module:**
- Registration and login flows (per-tenant isolation).
- Role-based access control (instructor can't access another tenant, student can't access admin routes).
- Session scoping to tenant.

**Payments module:**
- Stripe Connect onboarding flow (mock Stripe API at the HTTP boundary).
- Checkout session creation with correct application fee.
- Webhook processing: enrollment created on payment success, revoked on refund.
- Subscription lifecycle: creation, renewal, cancellation, access gating.

**Course Builder module:**
- Course/module/lesson CRUD operations.
- Ordering/reordering logic.
- Draft vs published visibility (students can't see draft courses).
- Tenant isolation (instructor A can't see/modify instructor B's courses).

## Out of Scope

- Comments / discussion per lesson
- Community / forum features
- Purchase power parity (regional pricing)
- Standalone marketing site for the platform itself
- Custom domain support (planned for future paid tier)
- Mobile app or native clients
- Advanced analytics beyond basic counts
- Multi-language / i18n support
- Affiliate or referral system
- Bulk import/export of content
- Live streaming or cohort-based courses
- Student account model decision (per-tenant vs global — deferred)
- Exact platform pricing tiers and percentages (deferred)
- Rich text editor choice (Tiptap vs Plate — deferred)
- File storage provider choice (must be S3-compatible — deferred)
- Certificate generation approach (PDF vs canvas — deferred)
- Quiz engine complexity (deferred, start with simple multiple choice)

## Further Notes

- **Deployment**: Hetzner VPS + Coolify + Docker. Estimated ~$12-25/month infrastructure for early stage.
- **Video hosting**: Start with Bunny Stream (cheapest), abstract the provider interface to allow swapping to Cloudflare Stream later.
- **Scaling**: Video delivery scales via the video provider. The VPS handles page serving, auth, and data. Scale path: CX22 → CX32 → CX42 → multi-server.
- **Reference architectures**: Emil Kowalski's course platform (most relevant), Swizec Teller's platform, CourseLit.
- The grilling session was paused — remaining open questions (student account model, additional features) will be resolved as they become blocking during implementation.
