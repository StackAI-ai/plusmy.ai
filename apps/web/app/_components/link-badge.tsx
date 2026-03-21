import Link from 'next/link';
import type { ReactNode } from 'react';
import { Badge, badgeVariants, cn, type BadgeProps } from '@plusmy/ui';

interface LinkBadgeProps {
  href?: string | null;
  tone?: BadgeProps['tone'];
  className?: string;
  children: ReactNode;
  title?: string;
}

export function LinkBadge({ href, tone = 'default', className, children, title }: LinkBadgeProps) {
  if (!href) {
    return (
      <Badge className={className} tone={tone} title={title}>
        {children}
      </Badge>
    );
  }

  return (
    <Link
      className={cn(
        badgeVariants({ variant: tone, className }),
        'hover:-translate-y-0.5 hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background'
      )}
      href={href}
      title={title}
    >
      {children}
    </Link>
  );
}
