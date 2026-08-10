export const DEMO_INPUT_LIMITS = {
  name: 120,
  restaurant: 160,
  email: 254,
  phone: 32,
  city: 80,
  message: 1000,
} as const;

export type DemoInput = { name: string; restaurant: string; email: string; phone: string; city: string; message: string };
export type DemoInputResult = { ok: true; value: DemoInput } | { ok: false; message: string };

function value(form: FormData, key: keyof DemoInput) {
  const item = form.get(key);
  return typeof item === "string" ? item.trim() : "";
}

export function parseDemoInput(form: FormData): DemoInputResult {
  const data: DemoInput = {
    name: value(form, "name"),
    restaurant: value(form, "restaurant"),
    email: value(form, "email").toLowerCase(),
    phone: value(form, "phone"),
    city: value(form, "city"),
    message: value(form, "message"),
  };
  if (!data.name || !data.restaurant || !data.email || !data.phone) return { ok: false, message: "Ad, restoran adı, e-posta ve telefon zorunludur." };
  for (const key of Object.keys(DEMO_INPUT_LIMITS) as Array<keyof DemoInput>) {
    if (data[key].length > DEMO_INPUT_LIMITS[key]) return { ok: false, message: "Girdiğiniz bilgilerden biri izin verilen uzunluğu aşıyor." };
  }
  if (/\p{Cc}/u.test(`${data.name}${data.restaurant}${data.email}${data.phone}${data.city}`)) return { ok: false, message: "Girdiğiniz bilgiler geçersiz karakter içeriyor." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) return { ok: false, message: "Geçerli bir e-posta adresi girin." };
  if (data.phone.replace(/\D/g, "").length < 10) return { ok: false, message: "Telefon numarası geçerli görünmüyor." };
  return { ok: true, value: data };
}

