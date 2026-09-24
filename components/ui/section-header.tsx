import type { ReactNode } from "react";

type SectionHeaderProps = {
  eyebrow?: ReactNode;
  title: ReactNode;
  copy?: ReactNode;
  align?: "start" | "center";
  as?: "h2" | "h3";
  size?: "1" | "2";
  id?: string;
};

/** Cabeçalho de seção: eyebrow + título + texto de apoio. */
export function SectionHeader({ eyebrow, title, copy, align = "start", as = "h2", size = "1", id }: SectionHeaderProps) {
  const Heading = as;

  return (
    <div className={`section-header${align === "center" ? " section-header-center" : ""}`}>
      {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
      <Heading id={id} className={size === "1" ? "title-1" : "title-2"}>
        {title}
      </Heading>
      {copy ? <p className="section-copy">{copy}</p> : null}
    </div>
  );
}
