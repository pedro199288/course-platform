# Generic Course Platform — Tech Stack & Spec

## Vision

A self-hosted, open-source course platform for general audiences. Designed to replace SaaS platforms like Thinkific (~1800/year) with a self-hosted solution at a fraction of the cost. Video-focused, but supporting mixed content types.

## Tech Stack

| Layer             | Technology                                             | Reasoning                                                                                                           |
| ----------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| **Language**      | TypeScript (full-stack)                                | Familiarity, type safety                                                                                            |
| **Framework**     | TanStack Start                                         | SSR + SPA hybrid, modern React meta-framework                                                                       |
| **Database**      | PostgreSQL + Drizzle ORM                               | Handles concurrent writes from students, webhooks, and background jobs better than SQLite                           |
| **Auth**          | Better Auth                                            | Self-hosted, works with Drizzle + PostgreSQL, supports email/password + social login                                |
| **Payments**      | Stripe                                                 | One-time purchases + subscriptions                                                                                  |
| **Video hosting** | Bunny Stream or Cloudflare Stream (behind abstraction) | Signed URLs for protection, adaptive bitrate. Decision deferred — start with Bunny (cheapest), swap later if needed |
| **Styling**       | Tailwind CSS                                           | Familiarity                                                                                                         |
| **UI Components** | shadcn/ui + Base UI (instead of Radix)                 | Unstyled primitives, full control over design                                                                       |
| **Deployment**    | Hetzner VPS + Coolify + Docker                         | ~4-8/mo, can host multiple projects on the same server                                                              |

## Course Structure

```
Course
  └── Module
        └── Lesson (video, text, quiz, or downloadable file)
```

Three-level hierarchy: **Course → Modules → Lessons**.

## Features (MVP)

### Content & Delivery

- Video lessons with protected playback (signed URLs, expiring tokens)
- Text/article lessons (rich text or markdown)
- Downloadable files (PDFs, worksheets)
- Quizzes / assessments
- Certificates of completion
- Student progress tracking

### Commerce

- Stripe integration for payments
- One-time course purchases
- Subscription model (monthly access to all content)
- Both models supported simultaneously

### Auth & Users

- Email/password registration
- Social login (Google, etc.)
- Student dashboard with enrolled courses and progress
- Instructor/admin role separation

### Not in MVP

- Comments / discussion per lesson
- Community / forum
- Purchase power parity (regional pricing)
- Landing page / marketing site (separate concern)

## Video Protection Strategy

**Signed URLs** (equivalent to what Thinkific uses):

- Video playback URLs expire after a short window
- Prevents link sharing
- Does NOT include true DRM (no Widevine) — a determined user can still screen-record, but this stops 99% of casual sharing

## Infrastructure Cost Estimate

| Component                                                 | Monthly cost                                    |
| --------------------------------------------------------- | ----------------------------------------------- |
| Hetzner VPS (CX22 or CX32)                                | 4.50 - 8/mo                                     |
| Video hosting (Bunny Stream, ~100h stored, ~500h watched) | ~5-15/mo                                        |
| Stripe fees                                               | 2.9% + 0.25 per transaction (passed to revenue) |
| Domain + email                                            | ~1-2/mo                                         |
| **Total**                                                 | **~12-25/mo**                                   |

Compared to Thinkific at ~150/mo, this is roughly **6-12x cheaper**.

## Scaling Path

| Stage       | Students        | Infrastructure               | Cost             |
| ----------- | --------------- | ---------------------------- | ---------------- |
| Launch      | 0 - 1,000       | Hetzner CX22 (2 vCPU, 4GB)   | ~12-20/mo total  |
| Growing     | 1,000 - 10,000  | Hetzner CX32 (4 vCPU, 8GB)   | ~20-40/mo total  |
| Established | 10,000 - 50,000 | Hetzner CX42 or multi-server | ~50-100/mo total |
| Large       | 50,000+         | Managed platform or cluster  | 100+/mo          |

Video delivery scales independently via the video provider — the VPS only handles page serving, auth, and data.

## Reference Projects

- [Emil Kowalski's course platform](https://emilkowal.ski/ui/how-i-built-my-course-platform) — Next.js, Tailwind, Supabase, Mux, LemonSqueezy. Most relevant architecture reference.
- [Swizec Teller's course platform](https://swizec.com/blog/why-and-how-i-built-my-own-course-platform/) — Gatsby, Gumroad, Vimeo, Auth0. Simpler "glue code" philosophy.
- [CourseLit](https://github.com/codelitdev/courselit) — Open-source Teachable alternative. AGPL-3.0, MongoDB, Node.js. Good feature reference but different stack.

## Open Decisions

- [ ] Bunny Stream vs Cloudflare Stream (test both, compare costs with real usage)
- [ ] Rich text editor choice for text lessons (Tiptap, Plate, or MDX files)
- [ ] Certificate generation approach (PDF generation library, or canvas-based)
- [ ] Quiz engine complexity (simple multiple choice vs complex assessment types)
