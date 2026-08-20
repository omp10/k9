import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Search, Car, Package, Layers, CheckCircle2, XCircle } from 'lucide-react';
import { adminService } from '../../services/adminService';

/**
 * Driver work mode.
 *
 * Which job streams a driver is set up for (serviceCapabilities) and which they currently
 * accept (workMode) decide whether unified dispatch offers them taxi rides, deliveries, or
 * both. The driver app has its own toggle; this screen is the admin-side equivalent, so a
 * driver on the wrong stream can be corrected without touching the database.
 *
 * One dropdown sets both fields together — picking "Taxi + Delivery" grants both capabilities
 * and mode 'all' — because a mode the driver has no capability for silently drops them out of
 * dispatch.
 */

const OPTIONS = [
  { value: 'taxi', label: 'Taxi only', icon: Car, caps: ['taxi'] },
  { value: 'delivery', label: 'Delivery only', icon: Package, caps: ['delivery'] },
  { value: 'all', label: 'Taxi + Delivery', icon: Layers, caps: ['taxi', 'delivery'] },
];

const optionFor = (driver) => {
  const caps = Array.isArray(driver.serviceCapabilities) && driver.serviceCapabilities.length
    ? driver.serviceCapabilities
    : ['taxi'];
  const mode = driver.workMode || 'all';
  // 'all' with a single capability is a legacy/backfill state — show what they can actually do.
  if (mode === 'all' && caps.length < 2) return caps[0];
  return mode;
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
      notify('error', err?.response?.data?.message || err.message || 'Could not load drivers');
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

  const change = async (driver, value) => {
    const option = OPTIONS.find((o) => o.value === value);
    if (!option) return;
    const previous = drivers;
    setSavingId(driver._id);
    // Optimistic: the row shows the new mode straight away, reverted if the API refuses.
    setDrivers((list) => list.map((d) => (
      d._id === driver._id ? { ...d, workMode: option.value, serviceCapabilities: option.caps } : d
    )));
    try {
      const res = await adminService.updateDriverStatus(driver._id, {
        workMode: option.value,
        serviceCapabilities: option.caps,
      });
      if (!res?.success) throw new Error(res?.message || 'Update failed');
      notify('success', `${driver.name || 'Driver'} set to ${option.label}`);
    } catch (err) {
      setDrivers(previous);
      notify('error', err?.response?.data?.message || err.message || 'Could not update work mode');
    } finally {
      setSavingId(null);
    }
  };

  const lastPage = paginator?.last_page || 1;

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Driver Work Mode</h1>
        <p className="text-sm text-gray-500">
          Controls which job stream each driver is dispatched for. Drivers can also change this
          themselves in the driver app.
        </p>
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

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        {loading ? (
          <div className="flex items-center justify-center gap-2 p-10 text-gray-500">
            <Loader2 className="animate-spin" size={18} /> Loading drivers…
          </div>
        ) : drivers.length === 0 ? (
          <div className="p-10 text-center text-sm text-gray-500">No drivers found.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3">Driver</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3">Vehicle</th>
                <th className="px-4 py-3 w-56">Work mode</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {drivers.map((driver) => {
                const current = optionFor(driver);
                const Icon = OPTIONS.find((o) => o.value === current)?.icon || Car;
                return (
                  <tr key={driver._id}>
                    <td className="px-4 py-3 font-medium text-gray-900">{driver.name || 'Unknown'}</td>
                    <td className="px-4 py-3 text-gray-600">{driver.phone || driver.mobile || '—'}</td>
                    <td className="px-4 py-3 text-gray-600">
                      {driver.vehicle_type || driver.transport_type || '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Icon size={16} className="text-gray-400" />
                        <select
                          value={current}
                          disabled={savingId === driver._id}
                          onChange={(e) => change(driver, e.target.value)}
                          className="flex-1 rounded-lg border border-gray-200 px-2 py-1.5 text-sm outline-none focus:border-gray-900 disabled:opacity-50"
                        >
                          {OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                        {savingId === driver._id && <Loader2 size={14} className="animate-spin text-gray-400" />}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

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
