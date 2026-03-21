import { LoginForm } from './login-form';

export default function LoginPage() {
  return (
    <div className="grid gap-6 md:grid-cols-[1.2fr_1fr]">
      <section className="rounded-[36px] border border-border/60 bg-card/75 p-8 shadow-glow backdrop-blur-xl">
        <p className="text-sm uppercase tracking-[0.24em] text-muted-foreground">Workspace access</p>
        <h1 className="mt-4 text-4xl font-semibold leading-tight text-ink">Sign in to operate your AI control plane.</h1>
        <p className="mt-5 max-w-xl text-sm leading-7 text-muted-foreground">
          Use a passwordless magic link. Once the session is created, the dashboard, workspace APIs, provider installs, and MCP authorization flow all use the same Supabase identity.
        </p>
      </section>
      <LoginForm />
    </div>
  );
}
