import { LoaderCircle } from 'lucide-react';
import type { ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
  danger: 'bg-red-700 text-white hover:bg-red-800 dark:bg-red-600 dark:hover:bg-red-500',
  ghost: 'text-stone-700 hover:bg-stone-200/70 dark:text-stone-300 dark:hover:bg-stone-800',
  primary: 'bg-orange-700 text-white hover:bg-orange-800 dark:bg-orange-500 dark:text-stone-950 dark:hover:bg-orange-400',
  secondary:
    'border border-stone-300 bg-white text-stone-800 hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:hover:bg-stone-800',
};

const SIZES: Record<ButtonSize, string> = {
  lg: 'h-12 px-6 text-base',
  md: 'h-10 px-4 text-sm',
  sm: 'h-8 px-3 text-sm',
};

/** ボタンの見た目(リンクをボタンの見た目にするときにも使う) */
export const buttonClasses = (variant: ButtonVariant = 'primary', size: ButtonSize = 'md', extra = ''): string =>
  `inline-flex items-center justify-center gap-2 rounded-lg font-medium no-underline transition-colors hover:no-underline disabled:cursor-not-allowed disabled:opacity-60 ${VARIANTS[variant]} ${SIZES[size]} ${extra}`;

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** 処理中はスピナーを出して無効にする(5.5) */
  loading?: boolean;
};

export function Button({ variant = 'primary', size = 'md', loading = false, className = '', children, disabled, type = 'button', ...rest }: Props) {
  return (
    <button type={type} className={buttonClasses(variant, size, className)} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}
