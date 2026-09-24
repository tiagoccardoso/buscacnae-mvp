import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const base = {
  width: 16,
  height: 16,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true
};

export function SearchIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="7" cy="7" r="4.75" />
      <path d="M10.5 10.5 14 14" />
    </svg>
  );
}

export function SparkleIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M8 1.75v2.5M8 11.75v2.5M1.75 8h2.5M11.75 8h2.5M3.6 3.6l1.6 1.6M10.8 10.8l1.6 1.6M3.6 12.4l1.6-1.6M10.8 5.2l1.6-1.6" />
    </svg>
  );
}

export function InboxIcon(props: IconProps) {
  return (
    <svg {...base} width={22} height={22} {...props}>
      <path d="M2 9.5 4 3.5h8l2 6M2 9.5V13h12V9.5M2 9.5h3.5l1 1.5h3l1-1.5H14" />
    </svg>
  );
}
