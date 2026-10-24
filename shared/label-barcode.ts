// Code 128 symbol widths (ISO/IEC 15417); generated once from the reference
// table and kept locally. Rendering never calls a barcode or image service.
const patterns = [
  "212222",
  "222122",
  "222221",
  "121223",
  "121322",
  "131222",
  "122213",
  "122312",
  "132212",
  "221213",
  "221312",
  "231212",
  "112232",
  "122132",
  "122231",
  "113222",
  "123122",
  "123221",
  "223211",
  "221132",
  "221231",
  "213212",
  "223112",
  "312131",
  "311222",
  "321122",
  "321221",
  "312212",
  "322112",
  "322211",
  "212123",
  "212321",
  "232121",
  "111323",
  "131123",
  "131321",
  "112313",
  "132113",
  "132311",
  "211313",
  "231113",
  "231311",
  "112133",
  "112331",
  "132131",
  "113123",
  "113321",
  "133121",
  "313121",
  "211331",
  "231131",
  "213113",
  "213311",
  "213131",
  "311123",
  "311321",
  "331121",
  "312113",
  "312311",
  "332111",
  "314111",
  "221411",
  "431111",
  "111224",
  "111422",
  "121124",
  "121421",
  "141122",
  "141221",
  "112214",
  "112412",
  "122114",
  "122411",
  "142112",
  "142211",
  "241211",
  "221114",
  "413111",
  "241112",
  "134111",
  "111242",
  "121142",
  "121241",
  "114212",
  "124112",
  "124211",
  "411212",
  "421112",
  "421211",
  "212141",
  "214121",
  "412121",
  "111143",
  "111341",
  "131141",
  "114113",
  "114311",
  "411113",
  "411311",
  "113141",
  "114131",
  "311141",
  "411131",
  "211412",
  "211214",
  "211232",
  "2331112",
];
export function labelBarcode(value: string) {
  let codes: number[];
  if (/^\d{4,32}$/.test(value)) {
    codes = [105];
    const paired = value.length - (value.length % 2);
    for (let i = 0; i < paired; i += 2)
      codes.push(Number(value.slice(i, i + 2)));
    if (paired < value.length)
      codes.push(100, value.charCodeAt(value.length - 1) - 32);
  } else if (/^[\x20-\x7e]{1,16}$/.test(value))
    codes = [104, ...Array.from(value, c => c.charCodeAt(0) - 32)];
  else
    throw Error(
      "Bu etiket için barkod 4–32 rakam veya en fazla 16 yazdırılabilir ASCII karakter olmalı."
    );
  const checksum = codes.reduce((n, c, i) => n + c * (i || 1), 0) % 103;
  codes.push(checksum, 106);
  const bars: { x: number; width: number }[] = [];
  let x = 10;
  for (const code of codes) {
    const p = patterns[code];
    for (let i = 0; i < p.length; i++) {
      const width = Number(p[i]);
      if (i % 2 === 0) bars.push({ x, width });
      x += width;
    }
  }
  return { codes, bars, width: x + 10 };
}
export function labelPrice(minor: number) {
  if (!Number.isSafeInteger(minor) || minor < 0)
    throw Error("Etiket fiyatı güvenli kuruş tutarı olmalı.");
  const n = BigInt(minor);
  return `${(n / 100n).toLocaleString("tr-TR")},${String(n % 100n).padStart(2, "0")} ₺`;
}
