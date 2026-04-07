import Link from "next/link";

type EmptyStateProps = {
  title: string;
  description: string;
  ctaHref?: string;
  ctaLabel?: string;
};

export function EmptyState({ title, description, ctaHref, ctaLabel }: EmptyStateProps) {
  return (
    <div className="surface-premium card empty empty-premium">
      <span className="eyebrow">Nada por aqui ainda</span>
      <strong style={{ fontSize: "1.3rem", letterSpacing: "-0.03em" }}>{title}</strong>
      <p className="muted" style={{ margin: 0, maxWidth: 620 }}>
        {description}
      </p>
      {ctaHref && ctaLabel ? (
        <Link href={ctaHref} className="button">
          {ctaLabel}
        </Link>
      ) : null}
    </div>
  );
}
