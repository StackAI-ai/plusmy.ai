import { LoginForm } from './login-form';
import { getSearchParam, type AppSearchParams } from '../_lib/search-params';
import { safeSignInReturnPath } from '../_lib/signin-return';

export default async function LoginPage({ searchParams }: { searchParams?: AppSearchParams }) {
  const returnPath = safeSignInReturnPath(await getSearchParam(searchParams, 'next'));
  const callbackFailed = (await getSearchParam(searchParams, 'error')) === 'callback_failed';
  return (
    <div className="grid gap-6 md:grid-cols-[1.2fr_1fr]">
      <section className="hidden rounded-[36px] border border-border/60 bg-card/75 p-8 shadow-glow backdrop-blur-xl md:block">
        <p className="text-sm uppercase tracking-[0.24em] text-muted-foreground">Workspace access</p>
        <h1 className="mt-4 text-4xl font-semibold leading-tight text-ink">Sign in to manage your business tools.</h1>
        <p className="mt-5 max-w-xl text-sm leading-7 text-muted-foreground">
          Use a passwordless magic link. Once the session is created, the dashboard, connections, platform catalog, and client approvals all use the same Supabase identity.
        </p>
      </section>
      <h1 className="sr-only md:hidden">Sign in to manage your business tools.</h1>
      <LoginForm returnPath={returnPath} callbackFailed={callbackFailed} />
    </div>
  );
}
