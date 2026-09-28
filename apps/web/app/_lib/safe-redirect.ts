export function safeAppRedirectPath(value: string | null | undefined, fallback: string) {
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(value)) {
    return fallback;
  }

  return value;
}

export function safeAppRedirectUrl(value: string | null | undefined, origin: string, fallback: string) {
  return new URL(safeAppRedirectPath(value, fallback), origin);
}
