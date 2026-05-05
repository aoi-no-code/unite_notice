import { Suspense } from 'react';
import { LoginForm } from './LoginForm';

export default function LoginPage() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <Suspense
        fallback={
          <div
            style={{
              width: '100%',
              maxWidth: 400,
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: 16,
              padding: 32,
              color: 'var(--muted)',
            }}
          >
            読み込み中…
          </div>
        }
      >
        <LoginForm />
      </Suspense>
    </main>
  );
}
