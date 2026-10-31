export async function requestConnectionSync(
  workspaceId: string,
  connectionId: string,
  fetcher: typeof fetch = fetch
): Promise<{ ok: boolean; message: string }> {
  try {
    const response = await fetcher('/api/connections/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspace_id: workspaceId, connection_id: connectionId })
    });
    const payload = await response.json().catch(() => null);
    if (response.ok) return { ok: true, message: 'Sync queued.' };
    const error = typeof payload?.error === 'string' ? payload.error : null;
    if (error === 'connection_changed') return { ok: false, message: 'This connection changed. Refresh the page and try again.' };
    if (error === 'connection_inactive') return { ok: false, message: 'This connection is not active. Reconnect or finish setup before syncing.' };
    if (error === 'connection_job_fencing_unavailable') return { ok: false, message: 'Sync is temporarily unavailable. Try again later.' };
    return { ok: false, message: error ?? 'Sync could not be queued.' };
  } catch {
    return { ok: false, message: 'Sync could not be queued. Check your connection and try again.' };
  }
}
