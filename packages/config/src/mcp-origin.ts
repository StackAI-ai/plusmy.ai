import { z } from 'zod';

export function isMcpHttpOrigin(value: string) {
  if (/[\s\\,*]/.test(value)) return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.origin === value;
  } catch {
    return false;
  }
}

const mcpAllowedOriginsSchema = z.string().optional()
  .transform((value) => value === undefined || value === '' ? [] : value.split(',').map((origin) => origin.trim()))
  .pipe(z.array(z.string().refine(isMcpHttpOrigin, 'Expected an exact serialized HTTP(S) origin.')));

const appOriginSchema = z.string().transform((value, ctx) => {
  try {
    const url = new URL(value);
    if (!/^https?:\/\//.test(value) || /[\s\\]/.test(value) || url.username || url.password || url.search || url.hash || !isMcpHttpOrigin(url.origin)) {
      throw new Error('Invalid APP_URL.');
    }
    return url.origin;
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Expected an HTTP(S) APP_URL without credentials, query, or fragment.' });
    return z.NEVER;
  }
});

// Parse only Origin policy fields before authentication; never surface secret-env validation errors.
export const mcpOriginPolicySchema = z.object({
  APP_URL: appOriginSchema,
  MCP_ALLOWED_ORIGINS: mcpAllowedOriginsSchema
});
