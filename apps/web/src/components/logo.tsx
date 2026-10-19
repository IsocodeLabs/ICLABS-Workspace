/** The Isocode Labs "IL" mark, traced from the brand logo. Inherits colour (currentColor). */
export function LogoMark({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="531 211.5 520 520"
      width={size}
      height={size}
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <path d="M635 352 712 298 712 672 635 720Z" />
      <path d="M762 276 838 223 838 603 947 537 947 603 797 700 762 700Z" />
    </svg>
  );
}
