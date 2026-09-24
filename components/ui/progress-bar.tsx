type ProgressBarProps = {
  value: number;
  label: string;
};

/** Barra de progresso determinada. Anima via transform (compositor). */
export function ProgressBar({ value, label }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));

  return (
    <div
      className="progress"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
    >
      <div className="progress-bar" style={{ transform: `scaleX(${clamped / 100})` }} />
    </div>
  );
}
