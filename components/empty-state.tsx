import Link from "next/link";
import { InboxIcon } from "@/components/ui/icons";

type EmptyStateProps = {
  title: string;
  description: string;
  ctaHref?: string;
  ctaLabel?: string;
};

export function EmptyState({ title, description, ctaHref, ctaLabel }: EmptyStateProps) {
  return (
    <div className="empty-state enter" role="status">
      <span className="empty-state-icon" aria-hidden="true">
        <InboxIcon />
      </span>
      <h2 className="title-3">{title}</h2>
      <p className="section-copy">{description}</p>
      {ctaHref && ctaLabel ? (
        <Link href={ctaHref} className="button">
          {ctaLabel}
        </Link>
      ) : null}
    </div>
  );
}
