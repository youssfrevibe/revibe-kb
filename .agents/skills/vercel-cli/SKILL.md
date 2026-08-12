---
name: vercel-cli
description: Orchestrates Vercel deployment, environment variable management, and project configuration using the Vercel CLI.
---

# Vercel CLI Skill

This skill allows the agent to interact with Vercel using the Vercel CLI.

## Core Commands

- **Authentication / Status**: `npx vercel whoami` or `npx vercel status`
- **Link Project**: `npx vercel link`
- **Deploy**: 
  - `npx vercel --prod` (Deploys to production)
  - `npx vercel` (Deploys to preview environment)
- **Environment Variables**:
  - `npx vercel env ls` (List environment variables)
  - `npx vercel env push .env.local <environment>` (Pushes local variables to Vercel)
  - `npx vercel env pull` (Pulls Vercel variables to local `.env.local`)
- **Logs**:
  - `npx vercel logs --prod` (View production runtime logs)
  - `npx vercel logs <url>` (View logs for a specific preview URL)

## Best Practices
1. **Always use `--yes` or non-interactive flags** when running Vercel CLI commands as a background task to prevent the terminal from hanging on user prompts (e.g. `npx --yes vercel --prod --yes`).
2. **Environment Syncing**: If local `.env.local` variables are changed, push them using `npx --yes vercel env push .env.local production`.
3. **Log Retrieval**: If a server error (500) occurs, immediately retrieve logs using `npx --yes vercel logs --prod` to diagnose the stack trace.
