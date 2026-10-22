/** ロゴ(足あと)。Swarm / Foursquare のロゴやブランドカラーは使わない(5.5) */
export function Logo({ className = 'size-7' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden focusable="false">
      <rect width="32" height="32" rx="8" className="fill-orange-600 dark:fill-orange-500" />
      <ellipse cx="11.5" cy="19" rx="3.6" ry="5.2" transform="rotate(-12 11.5 19)" fill="#fff" />
      <circle cx="8.6" cy="11.2" r="1.3" fill="#fff" />
      <circle cx="11.6" cy="10.2" r="1.3" fill="#fff" />
      <circle cx="14.4" cy="11" r="1.2" fill="#fff" />
      <ellipse cx="21" cy="14.5" rx="3.3" ry="4.8" transform="rotate(14 21 14.5)" fill="#fff" fillOpacity="0.85" />
      <circle cx="18.6" cy="7.4" r="1.2" fill="#fff" fillOpacity="0.85" />
      <circle cx="21.4" cy="6.9" r="1.2" fill="#fff" fillOpacity="0.85" />
      <circle cx="24" cy="8" r="1.1" fill="#fff" fillOpacity="0.85" />
    </svg>
  );
}
