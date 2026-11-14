import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import {
  Activity, ArrowLeft, ArrowRight, ArrowUpRight, CalendarDays,
  CalendarPlus, Check, CheckCircle2, ChevronDown, ClipboardList, Clock3,
  HeartPulse, LayoutDashboard, LoaderCircle, Mail, Menu, Search, ShieldCheck,
  Stethoscope, UserRound, Users, X, XCircle,
} from 'lucide-react';
import { EmptyState } from './components/EmptyState';
import { useToast } from './hooks/useToast';
import { SectionHeading } from './pages/SectionHeading';
import { AvailabilityPill, BookingStatus } from './components/StatusPill';
import { ApiError, clinicApi } from './services/api';
import type { Booking, Section, Slot } from './types';
import { formatDate, formatDateTime, formatTime, isUpcoming } from './utils/date';

const navItems: { id: Section; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'appointments', label: 'Appointments', icon: CalendarDays },
  { id: 'lookup', label: 'Find a booking', icon: Search },
  { id: 'history', label: 'Patient history', icon: ClipboardList },
];

function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 429) return `${error.message}${error.retryAfter ? ` Try again in ${error.retryAfter} seconds.` : ''}`;
    if (error.status === 409) return error.message;
    if (error.status === 401) return 'The assessment API key was rejected. Check the frontend and backend environment settings.';
    return error.message;
  }
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

function StatCard({
  label, value, detail, icon: Icon, tone,
}: {
  label: string; value: number; detail: string; icon: typeof CalendarDays; tone: 'blue' | 'green' | 'amber' | 'violet';
}) {
  return (
    <article className="stat-card">
      <div className="stat-topline">
        <span className="stat-label">{label}</span>
        <span className={`stat-icon stat-icon-${tone}`}><Icon size={19} strokeWidth={1.8} /></span>
      </div>
      <div className="stat-value">{value}</div>
      <div className="stat-detail">{detail}</div>
    </article>
  );
}

function Toast({ message, tone, onClose }: { message: string; tone: 'success' | 'error'; onClose: () => void }) {
  return (
    <div className={`toast toast-${tone}`} role="status">
      {tone === 'success' ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
      <span>{message}</span>
      <button className="toast-close" onClick={onClose} aria-label="Dismiss notification"><X size={16} /></button>
    </div>
  );
}

function BookingRow({ booking, onCancel }: { booking: Booking; onCancel?: (booking: Booking) => void }) {
  return (
    <div className="booking-row">
      <div className="booking-avatar"><UserRound size={18} /></div>
      <div className="booking-main">
        <strong>{booking.name}</strong>
        <span>{booking.email}</span>
        <small>Booking ID · {booking.id}</small>
      </div>
      <div className="booking-meta">
        <span>{booking.slot_id}</span>
        <BookingStatus status={booking.status} />
      </div>
      {booking.status === 'confirmed' && onCancel && (
        <button className="text-action danger-action" onClick={() => onCancel(booking)}>Cancel</button>
      )}
    </div>
  );
}

export default function App() {
  const [section, setSection] = useState<Section>('overview');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [allSlots, setAllSlots] = useState<Slot[]>([]);
  const [visibleSlots, setVisibleSlots] = useState<Slot[]>([]);
  const [providers, setProviders] = useState<string[]>([]);
  const [providerFilter, setProviderFilter] = useState('');
  const [slotsLoading, setSlotsLoading] = useState(true);
  const [slotsError, setSlotsError] = useState('');
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [bookingName, setBookingName] = useState('');
  const [bookingEmail, setBookingEmail] = useState('');
  const [bookingLoading, setBookingLoading] = useState(false);
  const bookingAttemptRef = useRef<{ signature: string; key: string } | null>(null);
  const [knownBookings, setKnownBookings] = useState<Record<string, Booking>>({});
  const { toast, showToast, dismissToast } = useToast();

  const [lookupId, setLookupId] = useState('');
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupResult, setLookupResult] = useState<Booking | null>(null);
  const [lookupError, setLookupError] = useState('');

  const [historyEmail, setHistoryEmail] = useState('');
  const [historyInput, setHistoryInput] = useState('');
  const [historyBookings, setHistoryBookings] = useState<Booking[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [cursorStack, setCursorStack] = useState<(string | null)[]>([null]);
  const [historyNextCursor, setHistoryNextCursor] = useState<string | null>(null);

  const refreshSlots = useCallback(async (provider = '') => {
    setSlotsLoading(true);
    setSlotsError('');
    try {
      const [all, filtered] = provider
        ? await Promise.all([clinicApi.getSlots(), clinicApi.getSlots(provider)])
        : [await clinicApi.getSlots(), [] as Slot[]];
      setAllSlots(all);
      setProviders([...new Set(all.map((slot) => slot.provider))].sort());
      setVisibleSlots(provider ? filtered : all);
    } catch (error) {
      setSlotsError(getErrorMessage(error));
    } finally {
      setSlotsLoading(false);
    }
  }, []);

  useEffect(() => { void refreshSlots(); }, [refreshSlots]);

  const visibleBookings = useMemo(() => Object.values(knownBookings), [knownBookings]);
  const confirmedCount = visibleBookings.filter((booking) => booking.status === 'confirmed').length;
  const cancelledCount = visibleBookings.filter((booking) => booking.status === 'cancelled').length;
  const availableCount = allSlots.filter((slot) => slot.available && isUpcoming(slot.start)).length;

  function rememberBooking(booking: Booking) {
    setKnownBookings((current) => ({ ...current, [booking.id]: booking }));
  }

  async function handleFilterChange(value: string) {
    setProviderFilter(value);
    await refreshSlots(value);
  }

  async function handleBookingSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedSlot) return;
    setBookingLoading(true);
    const payload = {
      slot_id: selectedSlot.id,
      name: bookingName.trim(),
      email: bookingEmail.trim(),
    };
    const signature = JSON.stringify(payload);
    const idempotencyKey = bookingAttemptRef.current?.signature === signature
      ? bookingAttemptRef.current.key
      : crypto.randomUUID();
    bookingAttemptRef.current = { signature, key: idempotencyKey };
    try {
      const booking = await clinicApi.createBooking(payload, idempotencyKey);
      bookingAttemptRef.current = null;
      rememberBooking(booking);
      showToast(`Appointment confirmed for ${booking.name}.`, 'success');
      setSelectedSlot(null);
      setBookingName('');
      setBookingEmail('');
      await refreshSlots(providerFilter);
    } catch (error) {
      if (error instanceof ApiError && error.status !== 0) bookingAttemptRef.current = null;
      showToast(getErrorMessage(error), 'error');
      if (error instanceof ApiError && error.status === 409) await refreshSlots(providerFilter);
    } finally {
      setBookingLoading(false);
    }
  }

  async function handleLookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!lookupId.trim()) return;
    setLookupLoading(true);
    setLookupError('');
    setLookupResult(null);
    try {
      const booking = await clinicApi.getBooking(lookupId.trim());
      setLookupResult(booking);
      rememberBooking(booking);
    } catch (error) {
      setLookupError(getErrorMessage(error));
    } finally {
      setLookupLoading(false);
    }
  }

  async function handleCancel(booking: Booking) {
    const confirmed = window.confirm(`Cancel the appointment for ${booking.name}? This will release the appointment slot.`);
    if (!confirmed) return;
    try {
      const updated = await clinicApi.cancelBooking(booking.id);
      rememberBooking(updated);
      setLookupResult((current) => current?.id === updated.id ? updated : current);
      setHistoryBookings((current) => current.map((item) => item.id === updated.id ? updated : item));
      showToast('The appointment has been cancelled and the slot is available again.', 'success');
      await refreshSlots(providerFilter);
    } catch (error) {
      showToast(getErrorMessage(error), 'error');
    }
  }

  async function loadHistory(email: string, cursor: string | null): Promise<boolean> {
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const page = await clinicApi.getBookings(email, 10, cursor);
      setHistoryEmail(email);
      setHistoryBookings(page.bookings);
      setHistoryNextCursor(page.next_cursor);
      setKnownBookings((current) => ({
        ...current,
        ...Object.fromEntries(page.bookings.map((booking) => [booking.id, booking] as const)),
      }));
      return true;
    } catch (error) {
      setHistoryError(getErrorMessage(error));
      return false;
    } finally {
      setHistoryLoading(false);
    }
  }

  async function handleHistorySearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!historyInput.trim()) return;
    setCursorStack([null]);
    setHistoryEmail('');
    setHistoryBookings([]);
    setHistoryNextCursor(null);
    await loadHistory(historyInput.trim(), null);
  }

  async function handleHistoryNext() {
    if (!historyNextCursor) return;
    const nextCursor = historyNextCursor;
    if (await loadHistory(historyEmail, nextCursor)) {
      setCursorStack((current) => [...current, nextCursor]);
    }
  }

  async function handleHistoryPrevious() {
    if (cursorStack.length <= 1) return;
    const nextStack = cursorStack.slice(0, -1);
    if (await loadHistory(historyEmail, nextStack[nextStack.length - 1])) {
      setCursorStack(nextStack);
    }
  }

  function navigate(next: Section) {
    setSection(next);
    setMobileMenuOpen(false);
  }

  const pageTitle = navItems.find((item) => item.id === section)?.label ?? 'Overview';

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileMenuOpen ? 'sidebar-open' : ''}`}>
        <div className="brand-lockup">
          <div className="brand-mark"><HeartPulse size={23} strokeWidth={2.2} /></div>
          <div><strong>carepoint</strong><span>CLINIC APPOINTMENTS</span></div>
          <button className="mobile-close" onClick={() => setMobileMenuOpen(false)} aria-label="Close navigation"><X size={19} /></button>
        </div>
        <div className="nav-caption">WORKSPACE</div>
        <nav className="side-nav" aria-label="Main navigation">
          {navItems.map(({ id, label, icon: Icon }) => (
            <button key={id} className={`nav-link ${section === id ? 'nav-link-active' : ''}`} onClick={() => navigate(id)}>
              <Icon size={18} strokeWidth={1.9} /><span>{label}</span>
              {id === 'appointments' && <span className="nav-count">{availableCount}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-spacer" />
        <div className="sidebar-support">
          <div className="support-icon"><ShieldCheck size={18} /></div>
          <strong>Secure appointment handling</strong>
          <p>Bookings are checked and confirmed by the clinic server.</p>
        </div>
        <div className="sidebar-footer"><span className="online-dot" /> API connection interface</div>
      </aside>

      {mobileMenuOpen && <button aria-label="Close navigation overlay" className="sidebar-scrim" onClick={() => setMobileMenuOpen(false)} />}

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <button className="mobile-menu-button" onClick={() => setMobileMenuOpen(true)} aria-label="Open navigation"><Menu size={21} /></button>
            <div className="breadcrumbs"><span>Workspace</span><span className="crumb-divider">/</span><strong>{pageTitle}</strong></div>
          </div>
          <div className="topbar-right">
            <span className="topbar-date">{new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())}</span>
            <div className="user-chip"><span className="user-chip-icon"><Stethoscope size={16} /></span><span><strong>Clinic desk</strong><small>Appointment team</small></span><ChevronDown size={15} className="user-chevron" /></div>
          </div>
        </header>

        <div className="content-wrap">
          {toast && <Toast message={toast.message} tone={toast.tone} onClose={dismissToast} />}

          {section === 'overview' && (
            <>
              <SectionHeading eyebrow="CLINIC OVERVIEW" title="Good day" description="A clear view of appointment availability and the bookings you have reviewed." action={
                <button className="primary-button" onClick={() => navigate('appointments')}><CalendarPlus size={17} /> Book appointment</button>
              } />

              {slotsError && <div className="inline-alert alert-error"><XCircle size={17} /><span>{slotsError}</span><button onClick={() => void refreshSlots(providerFilter)}>Retry</button></div>}

              <div className="stats-grid">
                <StatCard label="Appointment slots" value={allSlots.length} detail="Slots returned by the clinic API" icon={CalendarDays} tone="blue" />
                <StatCard label="Open future slots" value={availableCount} detail="Upcoming slots without a confirmed booking" icon={Clock3} tone="green" />
                <StatCard label="Confirmed bookings" value={confirmedCount} detail="In records loaded during this session" icon={CheckCircle2} tone="violet" />
                <StatCard label="Cancelled bookings" value={cancelledCount} detail="In records loaded during this session" icon={XCircle} tone="amber" />
              </div>

              <div className="overview-grid">
                <section className="panel schedule-panel">
                  <div className="panel-heading">
                    <div><h2>Upcoming availability</h2><p>Appointments currently open for booking</p></div>
                    <button className="subtle-button" onClick={() => navigate('appointments')}>View schedule <ArrowRight size={15} /></button>
                  </div>
                  {slotsLoading ? <div className="loading-state"><LoaderCircle className="spin" size={22} /> Loading appointment slots…</div> : (
                    <div className="mini-slot-list">
                      {allSlots.filter((slot) => slot.available && isUpcoming(slot.start)).slice(0, 4).map((slot) => (
                        <div className="mini-slot" key={slot.id}>
                          <div className="date-tile"><strong>{new Date(slot.start).getDate()}</strong><span>{new Intl.DateTimeFormat(undefined, { month: 'short' }).format(new Date(slot.start))}</span></div>
                          <div className="mini-slot-copy"><strong>{slot.provider}</strong><span>{formatTime(slot.start)} – {formatTime(slot.end)}</span></div>
                          <button className="icon-action" aria-label={`Book ${slot.provider}`} onClick={() => { setSelectedSlot(slot); navigate('appointments'); }}><ArrowUpRight size={18} /></button>
                        </div>
                      ))}
                      {!allSlots.some((slot) => slot.available && isUpcoming(slot.start)) && (
                        <EmptyState title="No upcoming slots available" description="New appointment times will appear here when they are added to the clinic schedule." />
                      )}
                    </div>
                  )}
                </section>

                <section className="panel quick-panel">
                  <div className="panel-heading"><div><h2>Quick actions</h2><p>Common appointment tasks</p></div><Activity size={19} className="panel-heading-icon" /></div>
                  <button className="quick-action" onClick={() => navigate('appointments')}>
                    <span className="quick-action-icon quick-blue"><CalendarPlus size={19} /></span>
                    <span><strong>Schedule an appointment</strong><small>Choose an available clinic slot</small></span>
                    <ArrowRight size={17} />
                  </button>
                  <button className="quick-action" onClick={() => navigate('lookup')}>
                    <span className="quick-action-icon quick-purple"><Search size={19} /></span>
                    <span><strong>Find a booking</strong><small>Look up a booking reference</small></span>
                    <ArrowRight size={17} />
                  </button>
                  <button className="quick-action" onClick={() => navigate('history')}>
                    <span className="quick-action-icon quick-green"><Users size={19} /></span>
                    <span><strong>Patient booking history</strong><small>Review bookings by email address</small></span>
                    <ArrowRight size={17} />
                  </button>
                </section>
              </div>

              <div className="bottom-note"><ShieldCheck size={16} /><span>Appointment availability is verified by the backend at booking time. A slot shown as available can still be claimed by another patient before submission.</span></div>
            </>
          )}

          {section === 'appointments' && (
            <>
              <SectionHeading eyebrow="SCHEDULE" title="Appointments" description="Browse clinic availability and reserve a time for a patient." action={<button className="secondary-button" onClick={() => void refreshSlots(providerFilter)}><Activity size={16} /> Refresh schedule</button>} />
              <section className="panel">
                <div className="panel-toolbar">
                  <div><h2>Available appointment slots</h2><p>{visibleSlots.length} slot{visibleSlots.length === 1 ? '' : 's'} returned</p></div>
                  <label className="filter-select"><span>Provider</span><select value={providerFilter} onChange={(event) => void handleFilterChange(event.target.value)}><option value="">All providers</option>{providers.map((provider) => <option key={provider} value={provider}>{provider}</option>)}</select></label>
                </div>
                {slotsError && <div className="inline-alert alert-error"><XCircle size={17} /><span>{slotsError}</span><button onClick={() => void refreshSlots(providerFilter)}>Retry</button></div>}
                {slotsLoading ? <div className="loading-state"><LoaderCircle className="spin" size={22} /> Loading appointment slots…</div> : visibleSlots.length ? (
                  <div className="slot-grid">
                    {visibleSlots.map((slot) => (
                      <article className={`slot-card ${!slot.available ? 'slot-card-unavailable' : ''}`} key={slot.id}>
                        <div className="slot-card-top"><span className="provider-avatar"><Stethoscope size={18} /></span><AvailabilityPill available={slot.available} /></div>
                        <div className="slot-provider">{slot.provider}</div>
                        <div className="slot-date"><CalendarDays size={15} /> {formatDate(slot.start)}</div>
                        <div className="slot-time"><Clock3 size={15} /> {formatTime(slot.start)} – {formatTime(slot.end)}</div>
                        <div className="slot-card-footer"><span>Slot ID · {slot.id}</span><button disabled={!slot.available || !isUpcoming(slot.start)} onClick={() => setSelectedSlot(slot)} className="slot-book-button">{!isUpcoming(slot.start) ? 'Passed' : slot.available ? 'Book slot' : 'Unavailable'} <ArrowRight size={14} /></button></div>
                      </article>
                    ))}
                  </div>
                ) : <EmptyState title="No appointment slots found" description={providerFilter ? 'Try another provider or select all providers.' : 'There are no slots in the clinic schedule yet.'} />}
              </section>
            </>
          )}

          {section === 'lookup' && (
            <>
              <SectionHeading eyebrow="BOOKING MANAGEMENT" title="Find a booking" description="Retrieve an appointment using its unique booking reference." />
              <section className="panel form-panel">
                <div className="form-intro-icon"><Search size={22} /></div>
                <h2>Booking reference lookup</h2>
                <p>Enter the booking ID provided when the appointment was confirmed.</p>
                <form className="lookup-form" onSubmit={handleLookup}>
                  <label className="field-label" htmlFor="booking-id">Booking ID</label>
                  <div className="input-with-button"><input id="booking-id" value={lookupId} onChange={(event) => setLookupId(event.target.value)} placeholder="e.g. 9f1c…" required /><button className="primary-button" disabled={lookupLoading || !lookupId.trim()}>{lookupLoading ? <LoaderCircle className="spin" size={17} /> : <Search size={17} />} Find booking</button></div>
                </form>
                {lookupError && <div className="inline-alert alert-error"><XCircle size={17} />{lookupError}</div>}
                {lookupResult && (
                  <div className="lookup-result">
                    <div className="result-heading"><div><span className="eyebrow">BOOKING DETAILS</span><h3>Appointment record</h3></div><BookingStatus status={lookupResult.status} /></div>
                    <div className="result-grid">
                      <div><span>Patient name</span><strong>{lookupResult.name}</strong></div>
                      <div><span>Email address</span><strong>{lookupResult.email}</strong></div>
                      <div><span>Slot reference</span><strong>{lookupResult.slot_id}</strong></div>
                      <div><span>Booking reference</span><strong className="break-word">{lookupResult.id}</strong></div>
                      <div><span>Booked on</span><strong>{formatDateTime(lookupResult.created_at)}</strong></div>
                    </div>
                    {lookupResult.status === 'confirmed' && <button className="outline-danger-button" onClick={() => void handleCancel(lookupResult)}><XCircle size={16} /> Cancel this booking</button>}
                  </div>
                )}
              </section>
            </>
          )}

          {section === 'history' && (
            <>
              <SectionHeading eyebrow="PATIENT RECORDS" title="Patient history" description="Review a patient's appointment records using their email address." />
              <section className="panel history-panel">
                <form className="history-search" onSubmit={handleHistorySearch}>
                  <div className="history-search-copy"><span className="field-label">Patient email address</span><p>Results are matched case-insensitively and displayed from oldest to newest.</p></div>
                  <div className="history-search-controls"><div className="input-icon-wrap"><Mail size={17} /><input type="email" value={historyInput} onChange={(event) => setHistoryInput(event.target.value)} placeholder="patient@example.com" required /></div><button className="primary-button" disabled={historyLoading || !historyInput.trim()}>{historyLoading ? <LoaderCircle className="spin" size={17} /> : <Search size={17} />} Search</button></div>
                </form>
                {historyError && <div className="inline-alert alert-error"><XCircle size={17} />{historyError}</div>}
                {historyLoading ? <div className="loading-state"><LoaderCircle className="spin" size={22} /> Loading patient history…</div> : historyEmail ? (
                  <>
                    <div className="history-results-header"><div><h2>Booking history</h2><p>{historyEmail}</p></div><span className="result-count">{historyBookings.length} record{historyBookings.length === 1 ? '' : 's'} on this page</span></div>
                    {historyBookings.length ? <div className="booking-list">{historyBookings.map((booking) => <BookingRow key={booking.id} booking={booking} onCancel={(item) => void handleCancel(item)} />)}</div> : <EmptyState title="No bookings found" description="There are no appointment records for this email address." />}
                    <div className="pagination-bar"><span>Page {cursorStack.length}</span><div><button className="pagination-button" disabled={cursorStack.length <= 1 || historyLoading} onClick={() => void handleHistoryPrevious()}><ArrowLeft size={15} /> Previous</button><button className="pagination-button" disabled={!historyNextCursor || historyLoading} onClick={() => void handleHistoryNext()}>Next <ArrowRight size={15} /></button></div></div>
                  </>
                ) : <EmptyState title="Search for a patient" description="Enter the email address associated with the appointments to view their booking history." />}
              </section>
            </>
          )}

          <footer className="page-footer"><span>Carepoint Clinic Booking</span><span>Connected to the clinic booking API</span></footer>
        </div>
      </main>

      {selectedSlot && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !bookingLoading) setSelectedSlot(null); }}>
          <section className="booking-modal" role="dialog" aria-modal="true" aria-labelledby="booking-modal-title">
            <div className="modal-topline"><div className="modal-icon"><CalendarPlus size={21} /></div><button className="modal-close" onClick={() => setSelectedSlot(null)} disabled={bookingLoading} aria-label="Close booking form"><X size={19} /></button></div>
            <span className="eyebrow">NEW APPOINTMENT</span>
            <h2 id="booking-modal-title">Confirm a time</h2>
            <p className="modal-description">Enter the patient's details to request this appointment slot.</p>
            <div className="selected-slot-summary"><div className="selected-slot-provider"><Stethoscope size={17} /><strong>{selectedSlot.provider}</strong></div><div><CalendarDays size={15} />{formatDate(selectedSlot.start)}</div><div><Clock3 size={15} />{formatTime(selectedSlot.start)} – {formatTime(selectedSlot.end)}</div></div>
            <form className="booking-form" onSubmit={handleBookingSubmit}>
              <label className="field-label" htmlFor="patient-name">Patient name</label><input id="patient-name" value={bookingName} onChange={(event) => setBookingName(event.target.value)} placeholder="Full name" autoComplete="name" required minLength={1} />
              <label className="field-label" htmlFor="patient-email">Email address</label><input id="patient-email" type="email" value={bookingEmail} onChange={(event) => setBookingEmail(event.target.value)} placeholder="patient@example.com" autoComplete="email" required />
              <div className="modal-assurance"><ShieldCheck size={15} /><span>The server will verify availability before confirming the booking.</span></div>
              <div className="modal-actions"><button type="button" className="secondary-button" disabled={bookingLoading} onClick={() => setSelectedSlot(null)}>Back</button><button className="primary-button" disabled={bookingLoading || !bookingName.trim() || !bookingEmail.trim()}>{bookingLoading ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />} Confirm appointment</button></div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
