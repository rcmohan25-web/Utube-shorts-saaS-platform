'use client';

import { useEffect, useState, useCallback } from 'react';
import { apiFetch, ApiError } from '@/lib/api-client';
import type { OrganizationBranding } from '@shorts/shared';
import { DEFAULT_BRAND_COLOR } from '@shorts/shared';

const PRESET_COLORS = ['#6d5bff', '#22c55e', '#f97316', '#ec4899', '#0ea5e9'];

export default function BrandingPage() {
  const [branding, setBranding] = useState<OrganizationBranding | null>(null);
  const [color, setColor] = useState(DEFAULT_BRAND_COLOR);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(() => {
    apiFetch<OrganizationBranding>('/organizations/branding')
      .then((b) => {
        setBranding(b);
        if (b.brandColor) setColor(b.brandColor);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load branding'));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function onColorSave() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await apiFetch('/organizations/branding', {
        method: 'PUT',
        body: JSON.stringify({ brandColor: color }),
      });
      setNotice('Brand color updated — it now appears in the app, emails, and new Short renders.');
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save brand color');
    } finally {
      setSaving(false);
    }
  }

  async function onLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    setNotice(null);
    try {
      // Step 1: get a presigned PUT URL scoped to this org.
      const { uploadUrl, key } = await apiFetch<{ uploadUrl: string; key: string }>(
        '/organizations/branding/logo-upload-url',
        { method: 'POST', body: JSON.stringify({ contentType: file.type }) },
      );
      // Step 2: PUT the file straight to S3/R2 — never touches our API.
      const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (!putRes.ok) throw new Error('Upload to storage failed');
      // Step 3: confirm the new key on the org record.
      await apiFetch('/organizations/branding', {
        method: 'PUT',
        body: JSON.stringify({ logoS3Key: key }),
      });
      setNotice('Logo updated — it now appears in the sidebar, emails, and new Short renders.');
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not upload logo');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  return (
    <div className="max-w-xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Branding</h1>
        <p className="text-sm text-white/50">
          Your logo and color appear across the app, in emails, and burned into every new Short&apos;s
          branding overlay and captions.
        </p>
      </div>

      {notice && (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          {notice}
        </div>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}

      <section className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-5">
        <h2 className="text-sm font-medium text-white/70">Logo</h2>
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-32 items-center justify-center rounded-lg border border-dashed border-white/20 bg-black/30">
            {branding?.logoUrl ? (
              <img src={branding.logoUrl} alt="Logo" className="max-h-14 max-w-[120px] object-contain" />
            ) : (
              <span className="text-xs text-white/30">No logo</span>
            )}
          </div>
          <label className="cursor-pointer rounded-lg border border-white/10 px-4 py-2 text-sm hover:bg-white/5">
            {uploading ? 'Uploading…' : 'Upload logo'}
            <input
              type="file"
              accept="image/png,image/jpeg,image/svg+xml,image/webp"
              className="hidden"
              onChange={onLogoUpload}
              disabled={uploading}
            />
          </label>
        </div>
        <p className="text-xs text-white/30">
          PNG, JPEG, SVG, or WebP. Shown in the app sidebar, emails, and on every new Short&apos;s
          branding overlay.
        </p>
      </section>

      <section className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-5">
        <h2 className="text-sm font-medium text-white/70">Brand color</h2>
        <div className="flex items-center gap-3">
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="h-10 w-14 cursor-pointer rounded border border-white/10 bg-transparent"
          />
          <input
            type="text"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="w-28 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
          />
          <div className="flex gap-1">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                style={{ backgroundColor: c }}
                aria-label={`Use ${c}`}
                className="h-6 w-6 rounded-full border border-white/20"
              />
            ))}
          </div>
        </div>
        <button
          onClick={onColorSave}
          disabled={saving}
          className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium hover:bg-brand-600 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save color'}
        </button>
      </section>

      {branding && (
        <section className="space-y-2 rounded-2xl border border-white/10 bg-white/5 p-5">
          <h2 className="text-sm font-medium text-white/70">White-label status</h2>
          {branding.whiteLabelEnabled ? (
            <p className="text-sm text-emerald-300">
              &ldquo;Powered by Shorts Pilot&rdquo; is hidden across the app and emails — your Agency
              plan unlocks full white-label.
            </p>
          ) : (
            <p className="text-sm text-white/40">
              &ldquo;Powered by Shorts Pilot&rdquo; still appears in the app and emails. Upgrade to
              Agency to remove it everywhere.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
