'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '@/lib/api-client';
import { setAccessToken } from '@/lib/auth-store';

type Preview = { email: string; role: string; organizationName: string };

export default function AcceptInvitePage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();

  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    apiFetch<Preview>(`/invitations/${params.token}/preview`)
      .then(setPreview)
      .catch((err) => setPreviewError(err instanceof ApiError ? err.message : 'This invite link is invalid'));
  }, [params.token]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const tokens = await apiFetch<{ accessToken: string; refreshToken: string }>(
        `/invitations/${params.token}/accept`,
        { method: 'POST', body: JSON.stringify({ name, password }) },
      );
      setAccessToken(tokens.accessToken);
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not accept invite');
    } finally {
      setLoading(false);
    }
  }

  if (previewError) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <p className="text-sm text-red-400">{previewError}</p>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm space-y-4 rounded-2xl border border-white/10 bg-white/5 p-8"
      >
        <h1 className="text-xl font-semibold">
          {preview ? `Join ${preview.organizationName}` : 'Loading invite…'}
        </h1>
        {preview && (
          <p className="text-sm text-white/50">
            {preview.email} · invited as {preview.role}
          </p>
        )}

        <div className="space-y-1">
          <label className="text-sm text-white/70">Your name</label>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-brand-500"
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm text-white/70">Set a password</label>
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-brand-500"
          />
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={loading || !preview}
          className="w-full rounded-lg bg-brand-500 py-2 text-sm font-medium hover:bg-brand-600 disabled:opacity-50"
        >
          {loading ? 'Joining…' : 'Accept invite'}
        </button>
      </form>
    </main>
  );
}
