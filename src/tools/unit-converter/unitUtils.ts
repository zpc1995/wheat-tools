/**
 * Unit conversion.
 *
 * Most units are a simple ratio to a base unit, so they are stored as a single
 * factor. Temperature is the exception: °C/°F/K are related by an *affine*
 * transform (offset plus scale), not a ratio, so it gets explicit converters.
 * Treating temperature as a ratio is the classic bug here — it makes 0 °C
 * convert to 0 °F.
 *
 * Digital storage is handled in a separate group with both decimal (kB, 1000)
 * and binary (KiB, 1024) units, because conflating those is the other common
 * mistake and the difference is 10% by the terabyte.
 */

export type CategoryId =
  | 'length'
  | 'mass'
  | 'temperature'
  | 'area'
  | 'volume'
  | 'speed'
  | 'storage'
  | 'time'
  | 'pressure'
  | 'energy';

export interface Unit {
  id: string;
  label: string;
  /** Multiplier to the category's base unit (temperature uses functions). */
  factor?: number;
  /** Affine converters, used instead of `factor` for temperature. */
  toBase?: (value: number) => number;
  fromBase?: (value: number) => number;
  /** Accepted aliases for text parsing. */
  aliases?: string[];
}

export interface Category {
  id: CategoryId;
  label: string;
  /**
   * Unit **id** (not label) that other units are ratios against.
   *
   * Holding the id rather than a display string matters: a label like `°C` is
   * not an id, so any lookup by `baseUnit` would silently fail.
   */
  baseUnit: string;
  units: Unit[];
}

/** Helper for the common ratio case. */
const ratio = (id: string, label: string, factor: number, aliases?: string[]): Unit => ({
  id,
  label,
  factor,
  aliases,
});

export const CATEGORIES: Category[] = [
  {
    id: 'length',
    label: '长度',
    baseUnit: 'm',
    units: [
      ratio('nm', '纳米 nm', 1e-9),
      ratio('um', '微米 μm', 1e-6),
      ratio('mm', '毫米 mm', 1e-3),
      ratio('cm', '厘米 cm', 1e-2),
      ratio('dm', '分米 dm', 1e-1),
      ratio('m', '米 m', 1),
      ratio('km', '千米 km', 1000),
      ratio('in', '英寸 in', 0.0254, ['inch', 'inches']),
      ratio('ft', '英尺 ft', 0.3048, ['foot', 'feet']),
      ratio('yd', '码 yd', 0.9144),
      ratio('mi', '英里 mi', 1609.344, ['mile', 'miles']),
      ratio('nmi', '海里 nmi', 1852),
      ratio('li', '市里', 500),
      ratio('chi', '市尺', 1 / 3),
      ratio('cun', '市寸', 1 / 30),
    ],
  },
  {
    id: 'mass',
    label: '重量',
    baseUnit: 'kg',
    units: [
      ratio('mg', '毫克 mg', 1e-6),
      ratio('g', '克 g', 1e-3),
      ratio('kg', '千克 kg', 1),
      ratio('t', '吨 t', 1000),
      ratio('oz', '盎司 oz', 0.028349523125),
      ratio('lb', '磅 lb', 0.45359237, ['pound', 'pounds']),
      ratio('jin', '市斤', 0.5),
      ratio('liang', '市两', 0.05),
      ratio('stone', '英石 st', 6.35029318),
    ],
  },
  {
    id: 'temperature',
    label: '温度',
    baseUnit: 'c',
    units: [
      {
        id: 'c',
        label: '摄氏度 °C',
        aliases: ['c', 'celsius', '摄氏'],
        toBase: (value) => value,
        fromBase: (value) => value,
      },
      {
        id: 'f',
        label: '华氏度 °F',
        aliases: ['f', 'fahrenheit', '华氏'],
        toBase: (value) => ((value - 32) * 5) / 9,
        fromBase: (value) => (value * 9) / 5 + 32,
      },
      {
        id: 'k',
        label: '开尔文 K',
        aliases: ['k', 'kelvin'],
        toBase: (value) => value - 273.15,
        fromBase: (value) => value + 273.15,
      },
    ],
  },
  {
    id: 'area',
    label: '面积',
    baseUnit: 'm2',
    units: [
      ratio('mm2', '平方毫米 mm²', 1e-6),
      ratio('cm2', '平方厘米 cm²', 1e-4),
      ratio('m2', '平方米 m²', 1),
      ratio('km2', '平方千米 km²', 1e6),
      ratio('ha', '公顷 ha', 10000),
      ratio('mu', '亩', 666.6666666667),
      ratio('ft2', '平方英尺 ft²', 0.09290304),
      ratio('yd2', '平方码 yd²', 0.83612736),
      ratio('acre', '英亩 acre', 4046.8564224),
      ratio('mi2', '平方英里 mi²', 2589988.110336),
    ],
  },
  {
    id: 'volume',
    label: '体积',
    baseUnit: 'l',
    units: [
      ratio('ml', '毫升 mL', 1e-3),
      ratio('l', '升 L', 1, ['liter', 'litre']),
      ratio('m3', '立方米 m³', 1000),
      ratio('cm3', '立方厘米 cm³', 1e-3),
      ratio('gal-us', '美制加仑 gal', 3.785411784),
      ratio('gal-uk', '英制加仑 gal', 4.54609),
      ratio('qt-us', '美制夸脱 qt', 0.946352946),
      ratio('pt-us', '美制品脱 pt', 0.473176473),
      ratio('cup', '杯 cup（美制）', 0.2365882365),
      ratio('floz-us', '美制液盎司 fl oz', 0.0295735295625),
      ratio('tbsp', '汤匙 tbsp', 0.01478676478125),
      ratio('tsp', '茶匙 tsp', 0.00492892159375),
    ],
  },
  {
    id: 'speed',
    label: '速度',
    baseUnit: 'mps',
    units: [
      ratio('mps', '米/秒 m/s', 1),
      ratio('kmh', '千米/时 km/h', 1 / 3.6),
      ratio('mph', '英里/时 mph', 0.44704),
      ratio('kn', '节 kn', 0.5144444444),
      ratio('fts', '英尺/秒 ft/s', 0.3048),
      ratio('mach', '马赫 Mach（海平面）', 340.29),
    ],
  },
  {
    id: 'storage',
    label: '存储',
    baseUnit: 'b',
    units: [
      ratio('b', '字节 B', 1, ['byte', 'bytes']),
      // Decimal (SI) prefixes.
      ratio('kb', '千字节 kB (1000)', 1e3),
      ratio('mb', '兆字节 MB (1000²)', 1e6),
      ratio('gb', '吉字节 GB (1000³)', 1e9),
      ratio('tb', '太字节 TB (1000⁴)', 1e12),
      ratio('pb', '拍字节 PB (1000⁵)', 1e15),
      // Binary (IEC) prefixes — what operating systems usually display.
      ratio('kib', 'KiB (1024)', 1024),
      ratio('mib', 'MiB (1024²)', 1024 ** 2),
      ratio('gib', 'GiB (1024³)', 1024 ** 3),
      ratio('tib', 'TiB (1024⁴)', 1024 ** 4),
      ratio('pib', 'PiB (1024⁵)', 1024 ** 5),
      ratio('bit', '比特 bit', 1 / 8),
    ],
  },
  {
    id: 'time',
    label: '时间',
    baseUnit: 's',
    units: [
      ratio('ms', '毫秒 ms', 1e-3),
      ratio('s', '秒 s', 1, ['sec', 'second', 'seconds']),
      ratio('min', '分钟 min', 60, ['minute', 'minutes']),
      ratio('h', '小时 h', 3600, ['hour', 'hours']),
      ratio('d', '天 d', 86400, ['day', 'days']),
      ratio('wk', '周 wk', 604800, ['week', 'weeks']),
      ratio('mo', '月 mo（30 天）', 2592000),
      ratio('yr', '年 yr（365 天）', 31536000),
    ],
  },
  {
    id: 'pressure',
    label: '压力',
    baseUnit: 'pa',
    units: [
      ratio('pa', '帕斯卡 Pa', 1),
      ratio('kpa', '千帕 kPa', 1000),
      ratio('mpa', '兆帕 MPa', 1e6),
      ratio('bar', '巴 bar', 1e5),
      ratio('mbar', '毫巴 mbar', 100),
      ratio('atm', '标准大气压 atm', 101325),
      ratio('psi', '磅力/平方英寸 psi', 6894.757293168),
      ratio('mmhg', '毫米汞柱 mmHg', 133.322387415),
      ratio('kgfcm2', '千克力/平方厘米', 98066.5),
    ],
  },
  {
    id: 'energy',
    label: '能量',
    baseUnit: 'j',
    units: [
      ratio('j', '焦耳 J', 1),
      ratio('kj', '千焦 kJ', 1000),
      ratio('cal', '卡路里 cal', 4.184),
      ratio('kcal', '千卡 kcal', 4184, ['calorie', 'calories']),
      ratio('wh', '瓦时 Wh', 3600),
      ratio('kwh', '千瓦时 kWh', 3.6e6, ['度']),
      ratio('btu', '英热单位 BTU', 1055.05585262),
      ratio('ev', '电子伏 eV', 1.602176634e-19),
      ratio('ftlb', '英尺磅 ft·lb', 1.3558179483314004),
    ],
  },
];

export type ConvertResult =
  | { ok: true; value: number; formatted: string }
  | { ok: false; error: string };

/** Rounds for display without losing small or large magnitudes. */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (value === 0) return '0';

  const abs = Math.abs(value);
  // Very small or very large numbers are unreadable in plain decimal, so use
  // exponential notation outside a comfortable window.
  if (abs < 1e-6 || abs >= 1e15) {
    return value.toExponential(6).replace(/\.?0+e/, 'e');
  }

  // Otherwise keep 10 significant digits and trim trailing zeros.
  const text = Number(value.toPrecision(10)).toString();
  return text;
}

/** Converts between two units of the same category. */
export function convert(
  value: number,
  fromId: string,
  toId: string,
  category: Category,
): ConvertResult {
  if (!Number.isFinite(value)) return { ok: false, error: '请输入有效数字' };

  const from = category.units.find((unit) => unit.id === fromId);
  const to = category.units.find((unit) => unit.id === toId);
  if (!from || !to) return { ok: false, error: '未知的单位' };

  let base: number;
  if (from.toBase) {
    base = from.toBase(value);
  } else if (typeof from.factor === 'number') {
    base = value * from.factor;
  } else {
    return { ok: false, error: `单位 ${from.label} 缺少换算定义` };
  }

  let result: number;
  if (to.fromBase) {
    result = to.fromBase(base);
  } else if (typeof to.factor === 'number') {
    result = base / to.factor;
  } else {
    return { ok: false, error: `单位 ${to.label} 缺少换算定义` };
  }

  return { ok: true, value: result, formatted: formatNumber(result) };
}

/** Converts one value into every unit of the category. */
export function convertAll(
  value: number,
  fromId: string,
  category: Category,
): Array<{ unit: Unit; value: number; formatted: string }> {
  const out: Array<{ unit: Unit; value: number; formatted: string }> = [];
  for (const unit of category.units) {
    const result = convert(value, fromId, unit.id, category);
    if (result.ok) out.push({ unit, value: result.value, formatted: result.formatted });
  }
  return out;
}

/**
 * Parses a quantity with an optional unit, e.g. `12.5 cm` or `3kg`.
 *
 * Returns the matched unit so the UI can switch the source unit automatically,
 * which is usually what someone pasting "3kg" expects.
 */
export function parseQuantity(
  input: string,
  category: Category,
): { value: number; unit: Unit } | null {
  const text = input.trim();
  if (!text) return null;

  const match = /^([+-]?[\d.,]+(?:e[+-]?\d+)?)\s*([a-zA-Z°µμ/²³·]*)$/.exec(text);
  if (!match) return null;

  const numeric = Number(match[1].replace(/,/g, ''));
  if (!Number.isFinite(numeric)) return null;

  const suffix = match[2].toLowerCase();
  if (!suffix) {
    const fallback = category.units.find((unit) => unit.id === category.baseUnit);
    return fallback ? { value: numeric, unit: fallback } : null;
  }

  const unit = category.units.find(
    (candidate) =>
      candidate.id.toLowerCase() === suffix ||
      candidate.label.toLowerCase().includes(suffix) ||
      (candidate.aliases ?? []).includes(suffix),
  );

  return unit ? { value: numeric, unit } : null;
}

export function findCategory(id: CategoryId): Category {
  return CATEGORIES.find((category) => category.id === id) ?? CATEGORIES[0];
}

/** Common equivalences worth surfacing without any interaction. */
export const QUICK_FACTS: Array<{ label: string; detail: string }> = [
  { label: '1 英寸', detail: '2.54 厘米（精确值）' },
  { label: '1 磅', detail: '453.59237 克（精确值）' },
  { label: '1 加仑（美）', detail: '3.785411784 升' },
  { label: '1 海里', detail: '1852 米（精确值）' },
  { label: '1 市斤', detail: '500 克' },
  { label: '1 亩', detail: '≈ 666.67 平方米' },
  { label: '1 MiB', detail: '1.048576 MB（不是 1 MB）' },
  { label: '0 °C', detail: '32 °F = 273.15 K' },
];
