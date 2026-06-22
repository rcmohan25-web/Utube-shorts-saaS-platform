'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '@/lib/api-client';
import { setAccessToken } from '@/lib/auth-store';

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: '', email: '', password: '', organizationName: '' });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function update(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const tokens = await apiFetch<{ accessToken: string; refreshToken: string }>('/auth/register', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      setAccessToken(tokens.accessToken);
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm space-y-4 rounded-2xl border border-white/10 bg-white/5 p-8"
      >
        <h1 className="text-xl font-semibold">Create your workspace</h1>

        {(['organizationName', 'name', 'email'] as const).map((field) => (
          <div key={field} className="space-y-1">
            <label className="text-sm capitalize text-white/70">
              {field === 'organizationName' ? 'Organization name' : field}
            </label>
            <input
              type={field === 'email' ? 'email' : 'text'}
              required
              value={form[field]}
              onChange={update(field)}
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-brand-500"
            />
          </div>
        ))}

        <div className="space-y-1">
          <label className="text-sm text-white/70">Password</label>
          <input
            type="password"
            required
            minLength={8}
            value={form.password}
            onChange={update('password')}
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-brand-500"
          />
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-brand-500 py-2 text-sm font-medium hover:bg-brand-600 disabled:opacity-50"
        >
          {loading ? 'Creating…' : 'Create workspace'}
        </button>
      </form>
    </main>
  );
}
