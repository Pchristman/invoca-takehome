import type { MouseEvent, ReactNode } from 'react';
import { pushUrl } from '../useUrlState';

/** An in-app link. A plain left click changes the URL without a page load; anything else is left to the browser. */
export function Link({
  href,
  children,
  className,
  ariaCurrent,
}: {
  href: string;
  children: ReactNode;
  className?: string;
  ariaCurrent?: 'page';
}) {
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    const modified = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
    if (event.defaultPrevented || event.button !== 0 || modified) return;
    event.preventDefault();
    pushUrl(href);
  };
  return (
    <a href={href} className={className} aria-current={ariaCurrent} onClick={onClick}>
      {children}
    </a>
  );
}
