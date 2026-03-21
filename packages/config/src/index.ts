import { z } from 'zod';

const serverEnvSchema = z.object({
  APP_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  MCP_JWT_SECRET: z.string().min(32),
  WORKER_SHARED_SECRET: z.string().min(32),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  SLACK_CLIENT_ID: z.string().optional(),
  SLACK_CLIENT_SECRET: z.string().optional(),
  NOTION_CLIENT_ID: z.string().optional(),
  NOTION_CLIENT_SECRET: z.string().optional(),
  OPENAI_API_KEY: z.string().optional()
});

const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  APP_URL: z.string().url().optional()
});

let serverEnvCache: z.infer<typeof serverEnvSchema> | null = null;
let publicEnvCache: z.infer<typeof publicEnvSchema> | null = null;

export function getServerEnv() {
  if (!serverEnvCache) {
    serverEnvCache = serverEnvSchema.parse(process.env);
  }
  return serverEnvCache;
}

export function getPublicEnv() {
  if (!publicEnvCache) {
    publicEnvCache = publicEnvSchema.parse(process.env);
  }
  return publicEnvCache;
}
