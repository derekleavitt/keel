import type { ButtonHTMLAttributes } from 'react';
import { cn } from './cn.ts';

type Variant = 'primary' | 'secondary' | 'ghost';
type Size = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-accent-foreground hover:bg-accent/90',
  secondary: 'bg-surface text-foreground border border-line hover:bg-surface-2',
  ghost: 'text-muted hover:bg-surface-2 hover:text-foreground',
};

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-10 px-4 text-sm',
};

export function Button({ className, variant = 'primary', size = 'md', ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-md font-medium',
        'transition-colors focus-visible:outline-2 focus-visible:outline-offset-2',
        'focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-50',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
}
