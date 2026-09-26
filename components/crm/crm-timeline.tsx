import { formatDateTime } from "@/lib/format";
import type { TimelineEntry } from "@/lib/crm/timeline";

const ICON: Partial<Record<string, string>> = {
  "deal.created": "✦",
  "stage.changed": "→",
  "owner.changed": "◎",
  "deal.updated": "✎",
  "task.created": "☐",
  "task.completed": "☑",
  "task.reopened": "☐",
  "contact.created": "＋",
  "contact.linked": "★",
  "contact.deleted": "−",
  "deal.deleted": "×"
};

/** Timeline agrupada por mês: eventos automáticos + notas, mais recentes primeiro. */
export function CrmTimeline({ groups }: { groups: Array<{ key: string; label: string; entries: TimelineEntry[] }> }) {
  if (!groups.length) return <p className="footnote">Sem histórico ainda.</p>;
  return (
    <div className="crm-timeline">
      {groups.map((group) => (
        <section key={group.key} className="crm-timeline-group" aria-label={group.label}>
          <h4 className="caption crm-timeline-month">{group.label}</h4>
          <ol className="crm-timeline-list">
            {group.entries.map((entry) => (
              <li key={`${entry.kind}-${entry.id}`} className={`crm-timeline-item is-${entry.kind}`}>
                <span className="crm-timeline-icon" aria-hidden="true">{entry.kind === "note" ? "✉" : ICON[entry.activityType] ?? "•"}</span>
                <div className="crm-timeline-content">
                  {entry.kind === "note" ? (
                    <div className="crm-note">
                      <p className="crm-note-body">{entry.body}</p>
                    </div>
                  ) : (
                    <p className="crm-timeline-text">{entry.text}</p>
                  )}
                  <p className="caption">
                    {entry.actorName ?? "Sistema"} · <time dateTime={entry.at}>{formatDateTime(entry.at)}</time>
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
