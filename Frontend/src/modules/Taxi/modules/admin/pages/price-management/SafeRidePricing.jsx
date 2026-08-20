import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Search, ShieldCheck, Save, Info, CheckCircle2, XCircle } from 'lucide-react';
import api from '../../../../shared/api/axiosInstance';

/**
 * Safe Ride pricing.
 *
 * A rider who has been drinking can book on a dedicated tariff. This screen is where the
 * option is switched on per vehicle and priced. The config lives on the same pricing rows as
 * the normal tariff, so each vehicle (per service location + transport type) is independent.
 *
 * Any field left at 0 falls back to that vehicle's standard tariff — a flat surcharge alone is
 * enough to enable the option without restating the whole fare table.
 */

const MONEY_FIELDS = [
  { key: 'flat_surcharge', label: 'Flat surcharge', hint: 'Added on top of the fare' },
  { key: 'min_fare', label: 'Minimum fare', hint: 'Fare floor for a safe ride' },
  { key: 'base_price', label: 'Base price', hint: '0 = use standard' },
  { key: 'base_distance', label: 'Base distance (km)', hint: '0 = use standard' },
  { key: 'price_per_distance', label: 'Price per km', hint: '0 = use standard' },
  { key: 'time_price', label: 'Price per min', hint: '0 = use standard' },
];

const emptyDraft = () => ({
  enabled: false, flat_surcharge: 0, min_fare: 0,
  base_price: 0, base_distance: 0, price_per_distance: 0, time_price: 0, note: '',
});

export default function SafeRidePricing() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [search, setSearch] = useState('');
  const [banner, setBanner] = useState(null);

  const notify = (type, text) => {
    setBanner({ type, text });
    setTimeout(() => setBanner(null), 4000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/admin/safe-ride/pricing');
      const data = res?.data?.data ?? res?.data ?? [];
      const list = Array.isArray(data) ? data : [];
      setRows(list);
      setDrafts(Object.fromEntries(
        list.map((r) => [r.setPriceId, { ...emptyDraft(), ...(r.safeRide || {}) }]),
      ));
    } catch (err) {
      notify('error', err?.response?.data?.error || 'Could not load safe ride pricing');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const setField = (id, key, value) =>
    setDrafts((d) => ({ ...d, [id]: { ...d[id], [key]: value } }));

  const save = async (row) => {
    const draft = drafts[row.setPriceId];
    setSavingId(row.setPriceId);
    try {
      const res = await api.put(`/admin/safe-ride/pricing/${row.setPriceId}`, draft);
      const applied = res?.data?.data?.safeRide;
      if (applied) setField(row.setPriceId, 'enabled', applied.enabled);
      setRows((rs) => rs.map((r) =>
        r.setPriceId === row.setPriceId ? { ...r, safeRide: applied || r.safeRide } : r));
      notify('success', `${row.vehicleName}: ${applied?.enabled ? 'Safe Ride enabled' : 'Safe Ride disabled'}`);
    } catch (err) {
      // The API refuses to enable a vehicle with no pricing — surfacing that message
      // matters more than a generic failure toast.
      notify('error', err?.response?.data?.error || 'Could not save');
    } finally {
      setSavingId(null);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => (r.vehicleName || '').toLowerCase().includes(q));
  }, [rows, search]);

  const enabledCount = rows.filter((r) => r.safeRide?.enabled).length;

  return (
    <div className="p-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
            <ShieldCheck className="h-6 w-6 text-emerald-600" />
            Safe Ride Pricing
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            A dedicated tariff for riders who have been drinking. Turn it on per vehicle and
            price each one separately — riders only see it where it is enabled.
          </p>
        </div>
        <div className="rounded-lg bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700">
          {enabledCount} of {rows.length} vehicles enabled
        </div>
      </div>

      {banner && (
        <div className={`mb-4 flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium ${
          banner.type === 'success'
            ? 'bg-emerald-50 text-emerald-800'
            : 'bg-rose-50 text-rose-800'
        }`}>
          {banner.type === 'success'
            ? <CheckCircle2 className="h-4 w-4" />
            : <XCircle className="h-4 w-4" />}
          {banner.text}
        </div>
      )}

      <div className="mb-4 flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
        <Search className="h-4 w-4 text-slate-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search vehicle..."
          className="w-full bg-transparent text-sm outline-none"
        />
      </div>

      <div className="mb-4 flex items-start gap-2 rounded-lg bg-slate-50 px-4 py-3 text-xs text-slate-600">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
        <span>
          Leave a price at <strong>0</strong> to reuse that vehicle&apos;s standard tariff. A flat
          surcharge on its own is enough to enable the option. Enabling with no pricing at all is
          rejected, since riders would see an option that costs the same as a normal ride.
        </span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading pricing rules...
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 py-16 text-center text-sm text-slate-500">
          {rows.length === 0
            ? 'No pricing rules found. Create a Set Price for a vehicle first.'
            : 'No vehicle matches that search.'}
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map((row) => {
            const draft = drafts[row.setPriceId] || emptyDraft();
            const isOn = Boolean(draft.enabled);
            return (
              <div
                key={row.setPriceId}
                className={`rounded-xl border bg-white p-5 transition ${
                  isOn ? 'border-emerald-300 shadow-sm' : 'border-slate-200'
                }`}
              >
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-base font-semibold text-slate-900">
                        {row.vehicleName}
                      </span>
                      {!row.vehicleActive && (
                        <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
                          inactive
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {row.transportType || 'taxi'} &middot; standard base ₹{row.standardTariff?.base_price ?? 0}
                      {' '}&middot; ₹{row.standardTariff?.price_per_distance ?? 0}/km
                    </div>
                  </div>

                  <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
                    <span className={isOn ? 'text-emerald-700' : 'text-slate-400'}>
                      {isOn ? 'Enabled' : 'Disabled'}
                    </span>
                    <input
                      type="checkbox"
                      checked={isOn}
                      onChange={(e) => setField(row.setPriceId, 'enabled', e.target.checked)}
                      className="h-5 w-9 cursor-pointer appearance-none rounded-full bg-slate-300 transition checked:bg-emerald-500"
                    />
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
                  {MONEY_FIELDS.map((f) => (
                    <div key={f.key}>
                      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        {f.label}
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={draft[f.key] ?? 0}
                        onChange={(e) => setField(row.setPriceId, f.key, e.target.value)}
                        className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm outline-none focus:border-emerald-400"
                      />
                      <span className="mt-0.5 block text-[10px] text-slate-400">{f.hint}</span>
                    </div>
                  ))}
                </div>

                <div className="mt-4 flex flex-wrap items-end gap-3">
                  <div className="min-w-[240px] flex-1">
                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Note shown to riders
                    </label>
                    <input
                      type="text"
                      maxLength={200}
                      value={draft.note ?? ''}
                      onChange={(e) => setField(row.setPriceId, 'note', e.target.value)}
                      placeholder="e.g. Trained driver, extra care on the way home"
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-400"
                    />
                  </div>
                  <button
                    onClick={() => save(row)}
                    disabled={savingId === row.setPriceId}
                    className="flex items-center gap-2 rounded-lg bg-slate-900 px-5 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
                  >
                    {savingId === row.setPriceId
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <Save className="h-4 w-4" />}
                    Save
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
