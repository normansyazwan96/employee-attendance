import { EpfContributionCategory, SocsoContributionCategory } from "@prisma/client";

export const MALAYSIA_STATUTORY_RULE_VERSION = "MY-STAT-2025-10-01";
export const MALAYSIA_STATUTORY_SOURCES = {
  epf: "https://www.kwsp.gov.my/documents/d/guest/third_schedule_from_-1-october-2025",
  socso: "https://www.perkeso.gov.my/images/lindung/lindung-24-jam/NewContributionRateIncludingSKBBK.pdf",
  eis: "https://www.perkeso.gov.my/images/dokumen/151124-Rate%20Contribution%20ACT%20800.pdf",
} as const;

export type StatutoryContribution = {
  wagesSen: number;
  employeeSen: number;
  employerSen: number;
};

export type StatutoryContributionResult = {
  ruleVersion: string;
  epf: StatutoryContribution;
  socso: StatutoryContribution;
  eis: StatutoryContribution;
  employeeTotalSen: number;
  employerTotalSen: number;
};

function emptyContribution(wagesSen: number): StatutoryContribution {
  return { wagesSen: Math.max(0, Math.round(wagesSen)), employeeSen: 0, employerSen: 0 };
}

function epfBandCeilingSen(wagesSen: number): number {
  if (wagesSen <= 500_000) return Math.ceil(wagesSen / 2_000) * 2_000;
  return Math.ceil(wagesSen / 10_000) * 10_000;
}

function wholeRinggitCeiling(amountSen: number): number {
  return Math.ceil(amountSen / 100) * 100;
}

export function calculateEpfContribution(wagesSen: number, category: EpfContributionCategory): StatutoryContribution {
  const wages = Math.max(0, Math.round(wagesSen));
  if (category === EpfContributionCategory.EXEMPT || wages <= 1_000) return emptyContribution(wages);

  let employeeBps = 0;
  let employerBps = 0;
  switch (category) {
    case EpfContributionCategory.STANDARD_UNDER_60:
      employeeBps = 1_100;
      employerBps = wages <= 500_000 ? 1_300 : 1_200;
      break;
    case EpfContributionCategory.PR_OR_PRE_1998_60_PLUS:
      employeeBps = 550;
      employerBps = wages <= 500_000 ? 650 : 600;
      break;
    case EpfContributionCategory.MALAYSIAN_60_PLUS:
      employerBps = 400;
      break;
    case EpfContributionCategory.NON_MALAYSIAN:
      employeeBps = 200;
      employerBps = 200;
      break;
  }

  if (wages > 2_000_000) {
    return {
      wagesSen: wages,
      employeeSen: Math.round(wages * employeeBps / 10_000),
      employerSen: Math.round(wages * employerBps / 10_000),
    };
  }

  const scheduledWagesSen = epfBandCeilingSen(wages);
  return {
    wagesSen: wages,
    employeeSen: wholeRinggitCeiling(scheduledWagesSen * employeeBps / 10_000),
    employerSen: wholeRinggitCeiling(scheduledWagesSen * employerBps / 10_000),
  };
}

const socsoSpecialBands = [
  { upperSen: 3_000, firstEmployerSen: 60, firstEmployeeSen: 10, secondEmployerSen: 50 },
  { upperSen: 5_000, firstEmployerSen: 100, firstEmployeeSen: 20, secondEmployerSen: 80 },
  { upperSen: 7_000, firstEmployerSen: 160, firstEmployeeSen: 30, secondEmployerSen: 130 },
  { upperSen: 10_000, firstEmployerSen: 215, firstEmployeeSen: 40, secondEmployerSen: 175 },
  { upperSen: 14_000, firstEmployerSen: 300, firstEmployeeSen: 60, secondEmployerSen: 240 },
  { upperSen: 20_000, firstEmployerSen: 420, firstEmployeeSen: 85, secondEmployerSen: 335 },
] as const;

function socsoScheduledBand(wagesSen: number): { firstEmployerSen: number; firstEmployeeSen: number; secondEmployerSen: number } {
  const special = socsoSpecialBands.find((band) => wagesSen <= band.upperSen);
  if (special) return special;
  const capped = Math.min(wagesSen, 600_000);
  const index = Math.min(57, Math.ceil((capped - 20_000) / 10_000) - 1);
  const pair = Math.floor(index / 2);
  const odd = index % 2 === 1;
  const firstBaseEmployerSen = 435 + pair * 350 + (odd ? 180 : 0);
  const employeeSen = 125 + index * 50;
  const nonEmploymentInjurySen = 185 + pair * 150 + (odd ? 80 : 0);
  const secondBaseEmployerSen = 310 + pair * 250 + (odd ? 130 : 0);
  return {
    firstEmployerSen: firstBaseEmployerSen + nonEmploymentInjurySen,
    firstEmployeeSen: employeeSen,
    secondEmployerSen: secondBaseEmployerSen + nonEmploymentInjurySen,
  };
}

export function calculateSocsoContribution(wagesSen: number, category: SocsoContributionCategory): StatutoryContribution {
  const wages = Math.max(0, Math.round(wagesSen));
  if (category === SocsoContributionCategory.EXEMPT || wages === 0) return emptyContribution(wages);
  const band = socsoScheduledBand(wages);
  return category === SocsoContributionCategory.FIRST
    ? { wagesSen: wages, employeeSen: band.firstEmployeeSen, employerSen: band.firstEmployerSen }
    : { wagesSen: wages, employeeSen: 0, employerSen: band.secondEmployerSen };
}

const eisSpecialBands = [
  { upperSen: 3_000, contributionSen: 5 },
  { upperSen: 5_000, contributionSen: 10 },
  { upperSen: 7_000, contributionSen: 10 },
  { upperSen: 10_000, contributionSen: 20 },
  { upperSen: 14_000, contributionSen: 20 },
  { upperSen: 20_000, contributionSen: 30 },
] as const;

export function calculateEisContribution(wagesSen: number, eligible: boolean): StatutoryContribution {
  const wages = Math.max(0, Math.round(wagesSen));
  if (!eligible || wages === 0) return emptyContribution(wages);
  const special = eisSpecialBands.find((band) => wages <= band.upperSen);
  const contributionSen = special
    ? special.contributionSen
    : 50 + Math.min(57, Math.ceil((Math.min(wages, 600_000) - 20_000) / 10_000) - 1) * 20;
  return { wagesSen: wages, employeeSen: contributionSen, employerSen: contributionSen };
}

export function calculateMalaysiaStatutoryContributions(input: {
  epfWagesSen: number;
  socsoWagesSen: number;
  eisWagesSen: number;
  epfCategory: EpfContributionCategory;
  socsoCategory: SocsoContributionCategory;
  eisEligible: boolean;
}): StatutoryContributionResult {
  const epf = calculateEpfContribution(input.epfWagesSen, input.epfCategory);
  const socso = calculateSocsoContribution(input.socsoWagesSen, input.socsoCategory);
  const eis = calculateEisContribution(input.eisWagesSen, input.eisEligible);
  return {
    ruleVersion: MALAYSIA_STATUTORY_RULE_VERSION,
    epf,
    socso,
    eis,
    employeeTotalSen: epf.employeeSen + socso.employeeSen + eis.employeeSen,
    employerTotalSen: epf.employerSen + socso.employerSen + eis.employerSen,
  };
}
