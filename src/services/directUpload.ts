import { supabase } from '../lib/supabase';
import { request } from './http';

type UploadResult = { filePath: string; fileUrl: string; fileSize: number; fileName: string; mimeType: string; id?: string };
export async function directUpload(file: File, category: string, certificate = false): Promise<UploadResult> {
  if (!supabase) throw new Error('Supabase Storage is not configured.');
  const prepared = await request('/api/storage/uploads/sign', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName: file.name, mimeType: file.type, fileSize: file.size, category, certificate }),
  });
  const signed = await prepared.json();
  const uploaded = await supabase.storage.from(signed.bucket).uploadToSignedUrl(signed.path, signed.token, file, { contentType: file.type });
  if (uploaded.error) throw new Error(`Storage upload failed: ${uploaded.error.message}`);
  const completed = await request('/api/storage/uploads/complete', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticket: signed.ticket }),
  });
  const result = await completed.json();
  return result.data;
}
