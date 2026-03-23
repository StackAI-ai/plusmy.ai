import { ZodError, z, type ZodTypeAny } from 'zod'

export function validationErrorResponse(error: unknown) {
  if (error instanceof ZodError) {
    return Response.json(
      {
        error: 'invalid_request',
        issues: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message
        }))
      },
      { status: 400 }
    )
  }

  return Response.json({ error: 'invalid_request' }, { status: 400 })
}

export function parseSearchParams<TSchema extends ZodTypeAny>(url: string, schema: TSchema): z.output<TSchema> {
  const params = Object.fromEntries(new URL(url).searchParams.entries())
  return schema.parse(params)
}

export async function parseJsonBody<TSchema extends ZodTypeAny>(request: Request, schema: TSchema): Promise<z.output<TSchema>> {
  const body = await request.json().catch(() => {
    throw new ZodError([
      {
        code: 'custom',
        path: [],
        message: 'Request body must be valid JSON.'
      }
    ])
  })

  return schema.parse(body)
}
