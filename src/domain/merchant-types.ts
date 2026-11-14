import type { MerchantType } from "@/shared/contracts";

// Merchant types, not purchased items or motives. Visa Merchant Data Standards
// Manual, October 2026: https://usa.visa.com/dam/VCOM/download/merchants/visa-merchant-data-standards-manual.pdf
export const merchantTypes: Record<MerchantType, { label: string; codes: readonly string[] }> = {
  taxi: { label: "Taxicabs and limousines (including ride-share)", codes: ["4121"] },
  fuel: { label: "Fuel merchants", codes: ["5541", "5542"] },
  parking: { label: "Parking merchants", codes: ["7523"] },
  transit: { label: "Local transit merchants", codes: ["4111"] },
  fast_food: { label: "Fast-food merchants", codes: ["5814"] },
  bars: { label: "Bars and drinking places", codes: ["5813"] },
  restaurants: { label: "Restaurant merchants", codes: ["5812"] },
  pharmacies: { label: "Pharmacy merchants", codes: ["5912"] },
};
