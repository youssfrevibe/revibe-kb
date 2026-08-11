const REQUIRED = ["GEMINI_API_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;

/** Env vars that are required but not set. */
export function missingEnv(): string[] {
  return REQUIRED.filter((name) => !process.env[name]);
}

/**
 * A message that tells whoever is setting this up what to actually do. Without
 * an explicit check, the first database or Gemini call throws and the UI shows a
 * bare "Internal Server Error", which is the least useful thing it could say.
 */
export function configErrorMessage(missing: string[]): string {
  return (
    `Not configured yet: ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} missing. ` +
    `Copy .env.local.example to .env.local, fill it in, and restart the dev server.`
  );
}
