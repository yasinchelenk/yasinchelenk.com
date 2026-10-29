// Position Monitor helpers: distance, bearing, sea areas, freshness, ETA and laycan reach.
import { test, approx, near, eq } from './harness.js';
import { gcNm, bearing, seaArea, freshness, etaMs, laycanReach, aisEtaIso, shipType } from '../engine/geo.js';

test('Great circle and bearing', () => {
    approx(gcNm(51.5074, -0.1278, 48.8566, 2.3522), 185.5, 'London → Paris ≈ 185.5 nm (343.5 km)', 0.5);
    near(gcNm(0, 0, 0, 1), 60.04, '1° of longitude on the equator ≈ 60 nm', 0.05);
    near(bearing(0, 0, 0, 1), 90, 'due east', 1e-6);
    near(bearing(0, 0, 1, 0), 0, 'due north', 1e-6);
});

test('Sea areas', () => {
    eq(seaArea(41.10, 29.06), 'Istanbul Strait', 'Bosphorus');
    eq(seaArea(40.75, 28.20), 'Sea of Marmara', 'Marmara');
    eq(seaArea(44.00, 34.00), 'Black Sea', 'Black Sea');
    eq(seaArea(38.00, 25.50), 'Aegean Sea', 'Aegean');
    eq(seaArea(1.20, 103.80), 'Malacca Strait / Singapore', 'Singapore');
    eq(seaArea(NaN, 0), '', 'no position → empty');
});

test('Freshness, ETA, laycan reach, AIS codes', () => {
    const now = Date.parse('2026-11-01T12:00:00Z');
    eq(freshness('2026-11-01 11:30:00', now).level, 'green', '30 min old → green');
    eq(freshness('2026-11-01 02:00:00', now).level, 'amber', '10 h old → amber');
    eq(freshness('2026-10-30 12:00:00', now).level, 'red', '2 days old → red');
    const eta = etaMs(now, 288, 12);
    eq(new Date(eta).toISOString().slice(0, 16), '2026-11-02T12:00', '288 nm @ 12 kn = 24 h');
    eq(laycanReach(eta, '2026-11-01', '2026-11-05').status, 'in laycan', 'arrives inside laycan');
    eq(laycanReach(eta, '2026-11-04', '2026-11-08').status, 'early', 'arrives before laycan');
    eq(laycanReach(eta, '2026-10-25', '2026-11-01').status, 'late', 'arrives after cancelling');
    eq(aisEtaIso({ Month: 1, Day: 5, Hour: 8, Minute: 0 }, new Date('2026-12-20T00:00:00Z')), '2027-01-05 08:00', 'AIS ETA without year rolls into next year');
    eq([shipType(70), shipType(82), shipType(52)], ['Cargo', 'Tanker', 'Tug'], 'ship type codes');
});
