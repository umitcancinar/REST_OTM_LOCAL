/**
 * `as const` sart: motion'in Transition tipi ease icin sabit uzunlukta bir
 * tuple bekliyor. `as const` olmadan TypeScript bunu genel bir number[]'a
 * genisletir ve tip hatasi verir.
 */
export const EASE_OUT = [0.22, 1, 0.36, 1] as const;
