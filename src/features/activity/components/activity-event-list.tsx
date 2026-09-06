import {
  Bot,
  BookOpen,
  MessageSquareText,
  Network,
  type LucideIcon,
} from "lucide-react";
import { Link } from "react-router-dom";

import type {
  ActivityCategory,
  ActivityEvent,
} from "../../../../shared/contracts/activity";
import { formatResearchDate } from "../../spaces/format-research-date";
import {
  getActivityCategoryLabel,
  getActivityEventPresentation,
} from "../activity-presentation";

const categoryIcons: Record<ActivityCategory, LucideIcon> = {
  collaboration: Network,
  research: BookOpen,
  knowledge: MessageSquareText,
  agents: Bot,
};

export function ActivityEventList({ events }: { events: readonly ActivityEvent[] }) {
  return (
    <ol className="rw-activity-event-list">
      {events.map((event) => {
        const presentation = getActivityEventPresentation(event);
        const Icon = categoryIcons[event.category];
        return (
          <li key={event.id}>
            <article className={`rw-activity-event rw-activity-event--${event.category}`}>
              <span className="rw-activity-event__marker" aria-hidden="true">
                <Icon size={17} />
              </span>
              <div className="rw-activity-event__record">
                <div className="rw-activity-event__meta">
                  <span>{presentation.kindLabel}</span>
                  <span>{getActivityCategoryLabel(event.category)}</span>
                </div>
                <h3>{presentation.title}</h3>
                <p>{presentation.detail}</p>
              </div>
              <time dateTime={event.occurredAt}>{formatResearchDate(event.occurredAt)}</time>
              {presentation.href ? (
                <Link className="rw-activity-event__link" to={presentation.href}>
                  Open record<span aria-hidden="true">↗</span>
                </Link>
              ) : null}
            </article>
          </li>
        );
      })}
    </ol>
  );
}
