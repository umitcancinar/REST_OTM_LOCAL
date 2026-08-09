"use client";

import { useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent } from "react";
import { Check, Loader2 } from "lucide-react";

type Phase = "idle" | "orbiting" | "verified";

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

export function VerificationCodeForm({ error }: { error?: string }) {
  const [digits, setDigits] = useState(["", "", "", "", "", ""]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [networkError, setNetworkError] = useState<string | null>(null);
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const complete = digits.every(Boolean);

  function update(index: number, raw: string) {
    const values = raw.replace(/\D/g, "").slice(-1);
    setDigits((current) => current.map((digit, itemIndex) => itemIndex === index ? values : digit));
    if (values && index < 5) refs.current[index + 1]?.focus();
  }

  function onKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace" && !digits[index] && index > 0) refs.current[index - 1]?.focus();
    if (event.key === "ArrowLeft" && index > 0) refs.current[index - 1]?.focus();
    if (event.key === "ArrowRight" && index < 5) refs.current[index + 1]?.focus();
  }

  function onPaste(event: React.ClipboardEvent<HTMLDivElement>) {
    const pasted = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!pasted) return;
    event.preventDefault();
    setDigits(Array.from({ length: 6 }, (_, index) => pasted[index] ?? ""));
    refs.current[Math.min(pasted.length, 6) - 1]?.focus();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    if (!complete) return;
    event.preventDefault();
    setNetworkError(null);
    setPhase("orbiting");
    const form = event.currentTarget;
    try {
      const [response] = await Promise.all([
        fetch(form.action, { method: "POST", body: new FormData(form), redirect: "follow" }),
        wait(1250),
      ]);
      const destination = new URL(response.url);
      if (destination.searchParams.get("demo") === "success") {
        setPhase("verified");
        await wait(850);
      }
      window.location.assign(response.url);
    } catch {
      setPhase("idle");
      setNetworkError("Bağlantı kurulamadı. Lütfen tekrar deneyin.");
    }
  }

  return (
    <form action="/api/demo-request/verify" method="post" className="mt-7" onSubmit={submit}>
      <div className={`otp-orbit-stage otp-orbit-stage--${phase}`} onPaste={onPaste}>
        <div className="otp-ring" aria-hidden />
        <div className="otp-row" role="group" aria-label="6 haneli doğrulama kodu">
          {digits.map((digit, index) => (
            <input
              key={index}
              ref={(node) => { refs.current[index] = node; }}
              aria-label={`${index + 1}. hane`}
              autoComplete={index === 0 ? "one-time-code" : "off"}
              className="otp-slot"
              disabled={phase !== "idle"}
              inputMode="numeric"
              maxLength={1}
              name={`digit${index}`}
              onChange={(event) => update(index, event.target.value)}
              onKeyDown={(event) => onKeyDown(index, event)}
              pattern="[0-9]"
              required
              style={{ "--otp-x": `${(index - 2.5) * 58}px`, "--otp-delay": `${index * 35}ms` } as CSSProperties}
              value={digit}
            />
          ))}
        </div>
        <div className="otp-verified-tile" aria-hidden><Check size={24} strokeWidth={3} /></div>
      </div>
      {(error || networkError) && <p className="mt-3 text-[13px] font-medium text-red-600">{networkError || error}</p>}
      <button type="submit" disabled={!complete || phase !== "idle"} className="mt-5 flex w-full items-center justify-center gap-2 rounded-full bg-night px-5 py-3.5 text-[13.5px] font-bold text-white transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60">
        {phase === "orbiting" ? <><Loader2 size={16} className="animate-spin" /> Kod denetleniyor</> : phase === "verified" ? <><Check size={16} /> Doğrulandı</> : "Kodu doğrula ve talebi aç"}
      </button>
    </form>
  );
}
