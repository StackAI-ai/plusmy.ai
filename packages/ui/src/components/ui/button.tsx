import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-[0_18px_45px_-22px_hsl(var(--primary)/0.65)] hover:-translate-y-0.5 hover:bg-primary/90',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        outline: 'border border-border/70 bg-background/80 text-foreground shadow-sm hover:-translate-y-0.5 hover:bg-muted',
        ghost: 'text-muted-foreground hover:bg-secondary hover:text-foreground',
        accent: 'bg-accent text-accent-foreground shadow-[0_18px_45px_-22px_hsl(var(--accent)/0.65)] hover:-translate-y-0.5 hover:bg-accent/90'
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 rounded-lg px-3',
        lg: 'h-11 px-6',
        icon: 'h-10 w-10'
      }
    },
    defaultVariants: {
      variant: 'default',
      size: 'default'
    }
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  tone?: 'primary' | 'secondary';
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, tone, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    const resolvedVariant = variant ?? (tone === 'secondary' ? 'outline' : 'default');

    return <Comp className={cn(buttonVariants({ variant: resolvedVariant, size, className }))} ref={ref} {...props} />;
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };
