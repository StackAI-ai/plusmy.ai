import type { ComponentPropsWithoutRef, ReactElement, ReactNode } from 'react';
import { cloneElement, forwardRef, isValidElement } from 'react';
import { clsx } from 'clsx';

export function cn(...values: Array<string | false | null | undefined>) {
  return clsx(values);
}

type ButtonProps = ComponentPropsWithoutRef<'button'> & {
  asChild?: boolean;
  tone?: 'primary' | 'secondary';
  children: ReactNode;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, asChild = false, tone = 'primary', children, ...props },
  ref
) {
  const baseClassName = cn(
    'inline-flex items-center justify-center rounded-full px-5 py-3 text-sm font-semibold transition',
    tone === 'primary' && 'bg-[#13201d] text-white hover:-translate-y-0.5',
    tone === 'secondary' && 'border border-black/10 bg-white text-[#13201d] hover:-translate-y-0.5',
    className
  );

  if (asChild && isValidElement(children)) {
    const child = children as ReactElement<{ className?: string }>;
    return cloneElement(child, {
      className: cn(baseClassName, child.props.className)
    });
  }

  return (
    <button ref={ref} className={baseClassName} {...props}>
      {children}
    </button>
  );
});

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('rounded-[28px] border border-black/5 bg-white/75 p-6 shadow-panel backdrop-blur', className)}>
      {children}
    </div>
  );
}

export function Badge({
  children,
  tone = 'default'
}: {
  children: ReactNode;
  tone?: 'default' | 'moss' | 'brass';
}) {
  const tones = {
    default: 'bg-black/5 text-[#13201d]',
    moss: 'bg-[#2d5a44] text-white',
    brass: 'bg-[#c8a24d] text-[#13201d]'
  };

  return <span className={cn('inline-flex rounded-full px-3 py-1 text-xs font-semibold', tones[tone])}>{children}</span>;
}
