/** Live consumption data computed from HA state minus session baseline */
export interface LiveConsumption {
  currentKwh: number | null;
  usedKwh: number | null;
  electricityCost: number | null;
  currentWaterLiters: number | null;
  usedWaterLiters: number | null;
  waterCost: number | null;
  totalLiveCost: number | null;
}

/** Cabin card data for the admin dashboard grid */
export interface CabinOverview {
  id: number;
  name: string;
  status: "VACANT" | "OCCUPIED";
  powerOn: boolean | null;
  temperature: number | null;
  locked: boolean | null;
  currentGuestName: string | null;
  liveConsumption: LiveConsumption | null;
  hardware: {
    hasElectricity: boolean;
    hasWater: boolean;
    hasClimate: boolean;
    hasSmartLock: boolean;
  };
  haReachable: boolean;
}

/** Global pricing configuration */
export interface PricingConfig {
  pricePerKwh: number;
  pricePerLiterWater: number;
  currency: string;
}
