import { CalendarDays } from 'lucide-react';

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="empty-state">
      <div className="empty-icon"><CalendarDays size={22} /></div>
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}
