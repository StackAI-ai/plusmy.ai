export type AppSearchParams =
  | Promise<Record<string, string | string[] | undefined>>
  | Record<string, string | string[] | undefined>
  | undefined;

export async function getSearchParam(searchParams: AppSearchParams, key: string) {
  const resolved = searchParams ? await searchParams : {};
  const value = resolved?.[key];
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === 'string' ? value : null;
}
