const payrollFeatureSetting = import.meta.env.VITE_FEATURE_PAYROLL;

export const payrollFeatureEnabled = payrollFeatureSetting === "true"
  || (import.meta.env.PROD && payrollFeatureSetting !== "false");
