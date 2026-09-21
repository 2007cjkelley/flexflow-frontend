# FlexFlow

A scheduler that combines a calendar and a to-do list. You set your fixed
commitments (rigid events); FlexFlow automatically places your flex tasks
into the open time around them — splitting tasks into chunks, respecting
priority and deadlines, and re-flowing as your day changes.

**Live:** [skedge.us](https://skedge.us)

![FlexFlow screenshot](docs/screenshot.png)

## Features
- Auto-placement of flex tasks around rigid events
- Priority tiers (P1–P4) and deadlines that shape placement
- Live elapsed-time tracking that pauses and resumes with the schedule
- Drag-to-reorder queue with instant re-placement
- Two timezone modes per event: **Absolute** events stay locked to a fixed moment
  (a call with someone in London stays at the same instant wherever you are);
  **Naive** events keep their wall-clock time (a 7am workout stays at 7am
  when you travel)
- **Ambient availability** *(live app only)*: pick any set of calendars — yours,
  a partner's, a team's — and FlexFlow shades the time when all of them are
  free, directly on the calendar grid. Unlike "find a time" tools that you
  run on demand and that return a short list of slots, the overlay is always
  on: shared availability is visible at a glance as you browse your week,
  and it updates as events change.

## Stack
React · FastAPI · PostgreSQL · Supabase auth · Cloudflare Workers · Railway

## About this repo
This is the frontend only. The placement engine, backend, and test suite
are private.
