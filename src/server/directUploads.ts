import type express from 'express';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { supabaseAdminClient } from '../lib/supabaseServer.ts';
import { insertMedia } from '../db/media.ts';
import { decodeImage } from './supabaseStorage.ts';

type UploadUser = { userId: string; username: string; isAdmin: boolean; isFocal: boolean; assignedBarangay: string };
type Ticket = { actor: string; bucket: string; path: string; fileName: string; mimeType: string; fileSize: number; category: string; certificate: boolean; legal: boolean; expires: number };
const secret = () => process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const sign = (payload: string) => createHmac('sha256', secret()).update(payload).digest('hex');

export function registerDirectUploads(app: express.Express, userFor: (req: express.Request) => UploadUser) {
  app.post('/api/storage/uploads/sign', async (req, res) => {
    const user = userFor(req);
    const { fileName, mimeType, fileSize, category, certificate } = req.body || {};
    if (!user.isAdmin && !(certificate === true && user.isFocal && user.assignedBarangay)) {
      return res.status(403).json({ success: false, error: 'You cannot upload assets in this scope.' });
    }
    if (!supabaseAdminClient || !secret()) return res.status(503).json({ success: false, error: 'Supabase Storage is not configured.' });
    if (typeof fileName !== 'string' || !(typeof mimeType === 'string' && (/^image\/(jpeg|png|webp|gif)$/.test(mimeType) || (category === 'legal-documents' && mimeType === 'application/pdf'))) || !Number.isInteger(fileSize) || fileSize <= 0 || fileSize > 15 * 1024 * 1024) {
      return res.status(400).json({ success: false, error: 'Choose a JPEG, PNG, WebP or GIF image up to 15 MB.' });
    }
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120);
    const safeCategory = typeof category === 'string' ? category.toLowerCase().replace(/[^a-z0-9_-]/g, '-') : 'other';
    const scope = user.isAdmin ? 'shared' : `barangays/${user.assignedBarangay.toLowerCase().replace(/[^a-z0-9 _-]/g, '_')}`;
    const ticket: Ticket = {
      actor: user.userId, bucket: certificate === true ? 'certificates' : category === 'legal-documents' ? 'documents' : process.env.SUPABASE_LANDING_MEDIA_BUCKET || 'landing-page-media',
      path: `${certificate === true ? `${scope}/certificate-assets` : safeCategory}/${randomUUID()}-${safeName}`,
      fileName: safeName, mimeType, fileSize, category: safeCategory, certificate: certificate === true, legal: category === 'legal-documents', expires: Date.now() + 15 * 60 * 1000,
    };
    try {
      const { data, error } = await supabaseAdminClient.storage.from(ticket.bucket).createSignedUploadUrl(ticket.path, { upsert: false });
      if (error) throw error;
      const payload = Buffer.from(JSON.stringify(ticket)).toString('base64url');
      return res.json({ success: true, bucket: ticket.bucket, path: ticket.path, token: data.token, ticket: `${payload}.${sign(payload)}` });
    } catch {
      return res.status(503).json({ success: false, error: 'Unable to prepare Storage upload. Check bucket migrations and Storage configuration.' });
    }
  });

  app.post('/api/storage/uploads/complete', async (req, res) => {
    if (!supabaseAdminClient || !secret()) return res.status(503).json({ success: false, error: 'Supabase Storage is not configured.' });
    const [payload, signature] = typeof req.body?.ticket === 'string' ? req.body.ticket.split('.') : [];
    const expected = payload ? sign(payload) : '';
    if (!signature || !/^[a-f0-9]{64}$/.test(signature) || signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      return res.status(400).json({ success: false, error: 'Invalid upload ticket.' });
    }
    const ticket = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Ticket;
    const user = userFor(req);
    if (ticket.actor !== user.userId || ticket.expires < Date.now() || (!user.isAdmin && !(ticket.certificate && user.isFocal && ticket.path.startsWith(`barangays/${user.assignedBarangay.toLowerCase().replace(/[^a-z0-9 _-]/g, '_')}/certificate-assets/`)))) {
      return res.status(403).json({ success: false, error: 'Upload ticket expired or access denied.' });
    }
    try {
      const { data, error } = await supabaseAdminClient.storage.from(ticket.bucket).download(ticket.path);
      if (error || !data) throw new Error('Uploaded object was not found.');
      if (data.size !== ticket.fileSize) throw new Error('Uploaded file size does not match.');
      const bytes = Buffer.from(await data.arrayBuffer());
      if (ticket.legal && ticket.mimeType === 'application/pdf') {
        if (!ticket.fileName.toLowerCase().endsWith('.pdf') || bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('Choose a valid PDF document.');
      } else decodeImage(ticket.fileName, ticket.mimeType, `data:${ticket.mimeType};base64,${bytes.toString('base64')}`);
      let fileUrl: string;
      if (ticket.certificate || ticket.legal) {
        const signed = await supabaseAdminClient.storage.from(ticket.bucket).createSignedUrl(ticket.path, 3600);
        if (signed.error) throw signed.error;
        fileUrl = signed.data.signedUrl;
      } else fileUrl = supabaseAdminClient.storage.from(ticket.bucket).getPublicUrl(ticket.path).data.publicUrl;
      const asset = { filePath: ticket.path, fileUrl, fileSize: ticket.fileSize, fileName: ticket.fileName, mimeType: ticket.mimeType };
      const item = ticket.certificate || ticket.legal ? asset : await insertMedia({ ...asset, id: createHash('sha256').update(ticket.path).digest('hex'), category: ticket.category, uploadedBy: user.username });
      return res.status(201).json({ success: true, ...asset, data: item });
    } catch (error) {
      await supabaseAdminClient.storage.from(ticket.bucket).remove([ticket.path]);
      return res.status(400).json({ success: false, error: error instanceof Error ? error.message : 'Unable to finish upload.' });
    }
  });
}
