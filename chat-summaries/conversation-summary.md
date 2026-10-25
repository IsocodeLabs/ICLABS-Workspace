# Conversation Summary: Cloud Build failures after M0/M1

**Date:** 2026-10-17 | **Branch:** feat/m2-process-builder

## Problem

Cloud Build failed on `main` (commit `b4e5a42`, "M0 foundations and M1 login & access").

## Findings

1. **Build 1:** `lstat /workspace/Dockerfile: no such file or directory`
   - The trigger expected a `Dockerfile` at the repo root.
   - Ours is at `apps/web/Dockerfile` and must be built with the repo root as context (pnpm monorepo).
   - M0/M1 did not break anything. This was the first commit with code, so the trigger had never worked.
2. **Build 2:** `mkdir /workspace/apps/web/Dockerfile: not a directory`
   - After the trigger's Dockerfile path was changed, it was treated as a directory.
   - The trigger's built-in Dockerfile mode (`-t ... apps/web/Dockerfile`) doesn't fit this monorepo setup.

## Fix

- Added `cloudbuild.yaml` at the repo root: build with `-f apps/web/Dockerfile .`, push, deploy to Cloud Run.
- Switch the trigger's configuration type to **Cloud Build configuration file** and point it at `/cloudbuild.yaml`.
- `cloudbuild.yaml` has since been extended: Mumbai region (`asia-south1`), a separate `migrate` image and `workspace-migrate` Cloud Run job that runs DB migrations before deploy, and an 8-CPU machine type with a 30-minute timeout.

## Still to do

- Commit `cloudbuild.yaml` to `main` and retry the build.
- Set the Cloud Run runtime env vars and secrets (database URL, auth secret, SES settings).
