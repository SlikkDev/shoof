// Recommended metric definitions v1; awaiting business sign-off.
export const METRICS = {
  mediaSpend: { label: 'Paid media spend', unit: 'currency minor units', sources: ['meta_ads', 'google_ads'], fields: ['spendMinor'] },
  validLeads: { label: 'Unique valid enquiries', unit: 'enquiries', sources: ['crm'], fields: ['leadId'] },
  confirmedSales: { label: 'Confirmed sales', unit: 'sales', sources: ['crm'], fields: ['saleId'], gated: true },
  netCollected: { label: 'Net cash collected (including VAT)', unit: 'currency minor units', sources: ['payments'], fields: ['capturedMinor', 'refundMinor', 'chargebackMinor'], gated: true },
  paidLeads: { label: 'Paid-attributed enquiries (lead cohort)', unit: 'enquiries', sources: ['crm'], fields: ['leadId'], gated: true },
  newCustomers: { label: 'New paying customers (lead cohort)', unit: 'customers', sources: ['crm', 'payments'], fields: ['customerId'], gated: true, cohort: true },
  paidCohortCash: { label: 'Paid-cohort net cash in 30 days', unit: 'currency minor units', sources: ['crm', 'payments'], fields: ['cohortNetCashMinor'], gated: true, cohort: true },
  mediaCpl: { label: 'Media cost per paid enquiry', unit: 'currency minor units / enquiry', numerator: 'mediaSpend', denominator: 'paidLeads' },
  mediaCac: { label: 'Media cost per new paying customer', unit: 'currency minor units / customer', numerator: 'mediaSpend', denominator: 'newCustomers' },
  cashRoas: { label: '30-day cash ROAS (including VAT)', unit: 'ratio', numerator: 'paidCohortCash', denominator: 'mediaSpend' },
};
export const unavailable = (reasons) => ({ status: 'unavailable', value: null, reasons: [...new Set(reasons)] });
