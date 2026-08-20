import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Search, Car, Package, Layers, CheckCircle2, XCircle } from 'lucide-react';
import { adminService } from '../../services/adminService';

/**
 * Driver Work Mode.
 *
 * Which job streams a driver is set up for (serviceCapabilities) and which they currently
 * accept (workMode) decide whether unified dispatch offers them taxi rides, deliveries, or
 * both. The driver app has its own toggle; this screen is the admin-side equivalent, so a
 * driver on the wrong stream can be corrected without touching the database.
 *
 * One control per driver — three buttons, the active one highlighted — writes both fields
 * together, because a mode the driver has no capability for silently drops them out of
 * dispatch.
 */

const MODES = [
  { value: 'taxi', label: 'Taxi', icon: Car, caps: ['taxi'], blurb: 'Rides only' },
  { value: 'delivery', label: 'Delivery', icon: Package, caps: ['delivery'], blurb: 'Deliveries only' },
  { value: 'all', label: 'Both', icon: Layers, caps: ['taxi', 'delivery'], blurb: 'Rides + deliveries' },
];

const modeOf = (driver) => {
  const caps = Array.isArray(driver.serviceCapabilities) && driver.serviceCapabilities.length
    ? driver.serviceCapabilities
    : ['taxi'];
  const mode = driver.workMode || 'all';
  // 'all' with a single capability is a legacy/backfill state — show what they can actually do.
  return mode === 'all' && caps.length < 2 ? caps[0] : mode;
};

export default function DriverWorkMode() {
  const [drivers, setDrivers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [paginator, setPaginator] = useState(null);
  const [banner, setBanner] = useState(null);

  const notify = (type, text) => {
    setBanner({ type, text });
    setTimeout(() => setBanner(null), 4000);
  };

  const load = useCallback(async (nextPage = 1, term = '') => {
    setLoading(true);
    try {
      const res = await adminService.getDrivers(nextPage, 20, {
        approve: true,
        search: String(term || '').trim(),
      });
      if (!res?.success) throw new Error(res?.message || 'Failed to load drivers');
      setDrivers(res.data?.results || []);
      setPaginator(res.data?.paginator || null);
    } catch (err) {
      notify('error', err?.message || 'Could not load drivers');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(page, search); }, [load, page]);

  useEffect(() => {
    const timer = setTimeout(() => { setPage(1); load(1, search); }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const setMode = async (driver, mode) => {
    if (mode.value === modeOf(driver) || savingId) return;
    const previous = drivers;
    setSavingId(driver._id);
    // Optimistic: the row switches straight away, reverted if the API refuses.
    setDrivers((list) => list.map((d) => (
      d._id === driver._id ? { ...d, workMode: mode.value, serviceCapabilities: mode.caps } : d
    )));
    try {
      const res = await adminService.updateDriverStatus(driver._id, {
        workMode: mode.value,
        serviceCapabilities: mode.caps,
      });
      if (!res?.success) throw new Error(res?.message || 'Update failed');
      notify('success', `${driver.name || 'Driver'} → ${mode.blurb.toLowerCase()}`);
    } catch (err) {
      setDrivers(previous);
      notify('error', err?.message || 'Could not update work mode');
    } finally {
      setSavingId(null);
    }
  };

  const lastPage = paginator?.last_page || 1;

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Driver Work Mode</h1>
          <p className="text-sm text-gray-500">
            Pick what each driver gets dispatched: rides, deliveries, or both. Saves as you click.
          </p>
        </div>
        <div className="flex gap-4 text-xs text-gray-500">
          {MODES.map((m) => (
            <span key={m.value} className="flex items-center gap-1.5">
              <m.icon size={14} className="text-gray-400" />
              <b className="font-semibold text-gray-700">{m.label}</b> — {m.blurb}
            </span>
          ))}
        </div>
      </div>

      {banner && (
        <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
          banner.type === 'success'
            ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
            : 'bg-red-50 text-red-700 border border-red-100'
        }`}>
          {banner.type === 'success' ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
          {banner.text}
        </div>
      )}

      <div className="relative max-w-sm">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, phone, email or vehicle"
          className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-gray-900"
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white p-10 text-gray-500">
          <Loader2 className="animate-spin" size={18} /> Loading drivers…
        </div>
      ) : drivers.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">
          No drivers found.
        </div>
      ) : (
        <div className="space-y-2">
          {drivers.map((driver) => {
            const current = modeOf(driver);
            const saving = savingId === driver._id;
            return (
              <div
                key={driver._id}
                className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-gray-200 bg-white px-4 py-3"
              >
                <div className="min-w-[200px]">
                  <div className="font-medium text-gray-900">{driver.name || 'Unknown'}</div>
                  <div className="text-xs text-gray-500">
                    {driver.phone || driver.mobile || '—'}
                    {(driver.vehicle_type || driver.transport_type) && ` · ${driver.vehicle_type || driver.transport_type}`}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {saving && <Loader2 size={14} className="animate-spin text-gray-400" />}
                  <div className="flex rounded-lg border border-gray-200 p-0.5">
                    {MODES.map((m) => {
                      const active = m.value === current;
                      return (
                        <button
                          key={m.value}
                          type="button"
                          onClick={() => setMode(driver, m)}
                          disabled={saving}
                          title={m.blurb}
                          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors disabled:opacity-50 ${
                            active ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-100'
                          }`}
                        >
                          <m.icon size={14} />
                          {m.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {lastPage > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="rounded-lg border border-gray-200 px-3 py-1.5 disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-gray-500">Page {page} of {lastPage}</span>
          <button
            onClick={() => setPage((p) => Math.min(lastPage, p + 1))}
            disabled={page >= lastPage}
            className="rounded-lg border border-gray-200 px-3 py-1.5 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
