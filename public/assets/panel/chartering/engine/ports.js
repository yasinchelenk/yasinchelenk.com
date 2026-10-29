// Starter list of ports and waiting areas for the map layer and the laycan tool.
// Coordinates are approximate (port area, not a berth). Fallback only: the Monitor reads the editable port database (Ports tab).
export const PORTS = [
    ['Istanbul (Ambarlı)', 'TR', 40.966, 28.690], ['Haydarpaşa', 'TR', 40.996, 29.016], ['Izmit / Kocaeli', 'TR', 40.760, 29.920], ['Derince', 'TR', 40.752, 29.830],
    ['Gemlik', 'TR', 40.430, 29.100], ['Bandırma', 'TR', 40.355, 27.970], ['Tekirdağ', 'TR', 40.968, 27.510], ['Karabiga', 'TR', 40.402, 27.305], ['Çanakkale', 'TR', 40.150, 26.405],
    ['Aliağa', 'TR', 38.830, 26.950], ['Izmir', 'TR', 38.440, 27.140], ['Mersin', 'TR', 36.790, 34.640], ['Iskenderun', 'TR', 36.590, 36.170], ['Ceyhan', 'TR', 36.880, 35.930],
    ['Samsun', 'TR', 41.300, 36.350], ['Trabzon', 'TR', 41.005, 39.730], ['Zonguldak', 'TR', 41.460, 31.790], ['Karadeniz Ereğli', 'TR', 41.285, 31.420],
    ['Constanta', 'RO', 44.170, 28.660], ['Varna', 'BG', 43.200, 27.920], ['Burgas', 'BG', 42.490, 27.480], ['Odesa', 'UA', 46.490, 30.740], ['Chornomorsk', 'UA', 46.300, 30.660],
    ['Pivdennyi', 'UA', 46.620, 31.020], ['Novorossiysk', 'RU', 44.720, 37.790], ['Tuapse', 'RU', 44.100, 39.070], ['Kavkaz', 'RU', 45.330, 36.670], ['Poti', 'GE', 42.150, 41.660], ['Batumi', 'GE', 41.650, 41.640],
    ['Piraeus', 'GR', 37.940, 23.630], ['Thessaloniki', 'GR', 40.630, 22.920], ['Alexandria', 'EG', 31.190, 29.870], ['Damietta', 'EG', 31.470, 31.760], ['Port Said', 'EG', 31.260, 32.300],
    ['Beirut', 'LB', 33.900, 35.520], ['Tripoli (LB)', 'LB', 34.450, 35.820], ['Tartus', 'SY', 34.900, 35.870], ['Limassol', 'CY', 34.650, 33.020], ['Ravenna', 'IT', 44.490, 12.280],
    ['Gibraltar', 'GI', 36.140, -5.350], ['Rotterdam', 'NL', 51.950, 4.140], ['Antwerp', 'BE', 51.270, 4.330], ['Hamburg', 'DE', 53.540, 9.970], ['Gdańsk', 'PL', 54.400, 18.670],
    ['Fujairah', 'AE', 25.170, 56.360], ['Singapore', 'SG', 1.260, 103.840], ['Santos', 'BR', -23.960, -46.300], ['Houston', 'US', 29.730, -95.270],
].map(([name, country, lat, lon]) => ({ name, country, lat, lon }));

/** Waiting / anchorage areas (approximate centres and radius in nm). */
export const ANCHORAGES = [
    { name: 'Ahırkapı anchorage', lat: 40.995, lon: 28.975, radiusNm: 1.5 },
    { name: 'Zeytinburnu / Yenikapı anchorage', lat: 40.975, lon: 28.900, radiusNm: 2 },
    { name: 'Istanbul Strait N entrance (Black Sea waiting)', lat: 41.290, lon: 29.150, radiusNm: 4 },
    { name: 'Çanakkale S entrance (Kumkale / Tenedos)', lat: 39.990, lon: 26.120, radiusNm: 4 },
    { name: 'Çanakkale N entrance (Gelibolu)', lat: 40.420, lon: 26.700, radiusNm: 3 },
    { name: 'Port Said anchorage', lat: 31.400, lon: 32.330, radiusNm: 4 },
];
