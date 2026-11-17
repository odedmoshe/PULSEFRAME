import { forwardRef, type ButtonHTMLAttributes, type MouseEvent, type ReactNode } from 'react';
import { Kbd } from './Kbd.tsx';
import { Tooltip } from './Tooltip.tsx';
import { DS, SpinnerIcon, cx } from './util.tsx';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'pulse' | 'danger-quiet' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variant?: ButtonVariant;
  /** sm 28, md 32, lg 40 */
  size?: ButtonSize;
  icon?: ReactNode;
  /** Inline ring in place of the icon; the button keeps focus and ignores clicks. */
  busy?: boolean;
  /** Why the button cannot be used right now ("בחרו קליפ קודם"). The button stays focusable (aria-disabled) so the reason can be reached. */
  disabledReason?: string;
  /** Key cap(s) shown in the tooltip. */
  keys?: string[];
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, busy, disabledReason, keys, className, children, onClick, type = 'button', disabled, ...rest }, ref) {
  const blocked = !!disabledReason || !!busy;
  const handle = (e: MouseEvent<HTMLButtonElement>) => { if (blocked) { e.preventDefault(); return; } onClick?.(e); };
  const btn = (
    <button
      ref={ref} type={type} {...rest} onClick={handle}
      disabled={disabled && !disabledReason}
      aria-disabled={disabledReason || busy ? true : undefined} aria-busy={busy || undefined}
      className={cx(DS, 'pf-btn', `pf-btn-${variant}`, `pf-btn-${size}`, disabledReason && 'is-disabled', busy && 'is-busy', className)}
    >
      {busy ? <SpinnerIcon className="pf-spin" /> : icon}
      {children != null && <span className="pf-btn-label">{children}</span>}
    </button>
  );
  return disabledReason || keys ? <Tooltip label={disabledReason ?? ''} keys={keys} reason={!!disabledReason}>{btn}</Tooltip> : btn;
});

export interface IconButtonProps extends Omit<ButtonProps, 'children' | 'icon' | 'size'> {
  /** Required: an icon-only button is named by this and by its tooltip. */
  label: string;
  icon: ReactNode;
  /** 32 (md) or 28 (sm) */
  size?: 'sm' | 'md';
  pressed?: boolean;
}
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({ label, icon, size = 'md', keys, disabledReason, variant = 'ghost', className, pressed, ...rest }, ref) {
  return (
    <Tooltip label={disabledReason ?? label} keys={disabledReason ? undefined : keys} reason={!!disabledReason}>
      <Button ref={ref} {...rest} variant={variant} size={size} aria-label={label} aria-pressed={pressed} disabledReason={disabledReason} className={cx('pf-iconbtn', pressed && 'is-on', className)} icon={icon} />
    </Tooltip>
  );
});
export { Kbd };
