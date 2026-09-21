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

## Stack
React · FastAPI · PostgreSQL · Supabase auth · Cloudflare Workers · Railway

## About this repo
This is the frontend only. The placement engine, backend, and test suite
are private.
