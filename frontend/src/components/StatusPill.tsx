import { CheckCircle2, Clock3, XCircle } from 'lucide-react';

export function AvailabilityPill({ available }: { available: boolean }) {
  return available ? (
    <span className="status-pill status-available"><CheckCircle2 size={14} /> Available</span>
  ) : (
    <span className="status-pill status-unavailable"><Clock3 size={14} /> Booked</span>
  );
}

export function BookingStatus({ status }: { status: 'confirmed' | 'cancelled' }) {
  return status === 'confirmed' ? (
    <span className="status-pill status-available"><CheckCircle2 size={14} /> Confirmed</span>
  ) : (
    <span className="status-pill status-cancelled"><XCircle size={14} /> Cancelled</span>
  );
}
