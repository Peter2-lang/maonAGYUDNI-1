import { createHash } from 'node:crypto';
import { pool } from './index.ts';

export type SyncResult = { clientOperationId: string; entityId: string; serverEntityId?: string; serverPigId?: string; success: boolean; error?: string };
export async function claimSyncOperation(actor: string, operationId: string, operation: unknown): Promise<{ claimed: boolean; result?: SyncResult }> {
  const hash = createHash('sha256').update(JSON.stringify(operation)).digest('hex');
  const inserted = await pool.query(`INSERT INTO sync_operation_results (actor_id, operation_id, request_hash)
    VALUES ($1,$2,$3) ON CONFLICT (actor_id, operation_id) DO UPDATE SET lease_until = now() + interval '2 minutes'
    WHERE sync_operation_results.response IS NULL AND sync_operation_results.lease_until < now()
      AND sync_operation_results.request_hash = EXCLUDED.request_hash RETURNING operation_id`, [actor, operationId, hash]);
  if (inserted.rowCount) return { claimed: true };
  const existing = await pool.query('SELECT request_hash, response FROM sync_operation_results WHERE actor_id=$1 AND operation_id=$2', [actor, operationId]);
  if (existing.rows[0]?.request_hash !== hash) throw new Error('Conflict: operation ID was reused with different content.');
  if (!existing.rows[0]?.response) throw new Error('This operation is already being processed. Retry shortly.');
  return { claimed: false, result: existing.rows[0].response as SyncResult };
}
export async function finishSyncOperation(actor: string, operationId: string, result: SyncResult): Promise<void> {
  if (result.success) await pool.query('UPDATE sync_operation_results SET response=$3 WHERE actor_id=$1 AND operation_id=$2', [actor, operationId, JSON.stringify(result)]);
  else await pool.query('DELETE FROM sync_operation_results WHERE actor_id=$1 AND operation_id=$2 AND response IS NULL', [actor, operationId]);
}
