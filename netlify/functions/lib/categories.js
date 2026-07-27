'use strict';

// JV chart of accounts — expense categories, grouped by fund "set".
//
// The valid category list depends on the account (Expense Type): the General
// Fund uses the 7-series, every other account uses the 8-series. Source of truth
// is docs/chart-of-accounts/*.csv (captured from the accounting system; partial —
// extend both arrays as the full export arrives). Inlined here (not read from the
// CSV at runtime) so it bundles cleanly into the Netlify functions.

const GENERAL_FUND_ACCOUNT_CODE = '010000';

// 7-series — General Fund (HQ / org-level).
const GENERAL = [
  { code: "7111000", name: "Bank Service Charges" },
  { code: "7111100", name: "Account & Transaction Fees" },
  { code: "7111200", name: "Credit Card Fees" },
  { code: "7120300", name: "Fees & Registration-GovAgencies" },
  { code: "7120310", name: "Fees-Other Orgs and Mbrships" },
  { code: "7120410", name: "Software Programming Services" },
  { code: "7120420", name: "Consulting-State Registration" },
  { code: "7120500", name: "Database Software Licence&Host" },
  { code: "7120510", name: "License & subscription-Finance" },
  { code: "7120520", name: "License & subscription-HR" },
  { code: "7120530", name: "License & subscription-Operations" },
  { code: "7120540", name: "License and subs-Learning & Development" },
  { code: "7120600", name: "Accounting Management Services" },
  { code: "7120620", name: "Tax & Audit Services" },
  { code: "7122000", name: "Legal Fees" },
  { code: "7133100", name: "Liability Insurance" },
  { code: "7133200", name: "Workman's Comp" },
  { code: "7134000", name: "Key Man Insurance" },
  { code: "7143001", name: "NA Supplies" },
  { code: "7143400", name: "NA Hospitality & Care" },
  { code: "7145000", name: "NA Postage and Delivery" },
  { code: "7146100", name: "NA Office Rent" },
  { code: "7153001", name: "EE Supplies" },
  { code: "7153400", name: "EE Hospitality & Care" },
  { code: "7154000", name: "EE Administrative" },
  { code: "7155000", name: "EE Maintenance & Repairs" },
  { code: "7156150", name: "EE Rent" },
  { code: "7156300", name: "EE IT Support" },
  { code: "7159000", name: "EE Office Furniture & Equip" },
  { code: "7215100", name: "JV 2nd Culture Conf (Spring)" },
  { code: "7215200", name: "JV Marriage Retreat" },
  { code: "7215300", name: "JV Singles Retreat" },
  { code: "7215400", name: "JV Staff Conf (Fall)" },
  { code: "7215500", name: "JV Israel Retreat" },
  { code: "7215600", name: "JV Women's Retreat-Genl Fund" },
  { code: "7215610", name: "JV 2nd Culture Conf Expenses" },
  { code: "7215620", name: "JV Winter Academy Expenses" },
  { code: "7220098", name: "Creative Comm - Miscellaneous" },
  { code: "7220099", name: "Creative Comm - Software" },
  { code: "7220100", name: "Creative Comm - Equipment" },
  { code: "7220101", name: "Creative Comm - Production" },
  { code: "7220102", name: "Creative Comm - Contractors" },
  { code: "7220103", name: "Creative Comm - Marketing/Print" },
  { code: "7220104", name: "Creative Comm - Website Develop" },
  { code: "7220105", name: "Creative Comm - Conferences" },
  { code: "7226001", name: "JVK Camps" },
  { code: "7226004", name: "JV Kids Ministry Contra" },
  { code: "7227100", name: "Events & Meetings" },
  { code: "7227270", name: "Gifts for Partners" },
  { code: "7227290", name: "Travel - Partner Nickerson" },
  { code: "7227291", name: "Travel - Partner Howard" },
  { code: "7227295", name: "Travel - Partner Yates" },
  { code: "7227300", name: "Travel - Partners Hargan" },
  { code: "7232100", name: "Country Coaching - Travel - J Patty" },
  { code: "7239300", name: "Concentric Participation" },
  { code: "7314000", name: "Director of human resources" },
  { code: "7315000", name: "IT Leader" },
  { code: "7318600", name: "CFO Europe Compensation" },
  { code: "7319000", name: "CTeam Director" },
  { code: "7411100", name: "President Expenses" },
  { code: "7411300", name: "Chief Financial Officer" },
  { code: "7412101", name: "President Travel-Lodging" },
  { code: "7412102", name: "President Travel-Mileage" },
  { code: "7412103", name: "President Travel-Meals & Other" },
  { code: "7412104", name: "President Travel-Rental Car" },
  { code: "7412105", name: "President Travel - Air & Train" },
  { code: "7412106", name: "President Travel-Spouse Travel" },
  { code: "7412201", name: "Intl EVP Travel-Lodging" },
  { code: "7412202", name: "Intl EVP Travel-Mileage" },
  { code: "7412203", name: "Intl EVP Travel-Meals & Other" },
  { code: "7412204", name: "Intl EVP Travel Rental Car" },
  { code: "7412205", name: "Intl EVP Travel-Air & Train" },
  { code: "7412206", name: "Intl EVP Travel Spouse Travel" },
  { code: "7412221", name: "Ntl EVP Travel-Lodging" },
  { code: "7412222", name: "Ntl EVP Travel-Mileage" },
  { code: "7412223", name: "Ntl EVP Travel-Meals & Other" },
  { code: "7412224", name: "Ntl EVP Travel Rental Car" },
  { code: "7412225", name: "Ntl EVP Travel-Air & Train" },
  { code: "7412226", name: "Ntl EVP Travel Spouse Travel" },
  { code: "7412301", name: "CFO Travel - Lodging" },
  { code: "7412302", name: "CFO Travel-Mileage" },
  { code: "7412303", name: "CFO Travel- Meals & Other" },
  { code: "7412304", name: "CFO Travel- Rental Car" },
  { code: "7412305", name: "CFO Travel- Air & Train" },
  { code: "7412306", name: "CFO Travel- Spouse Travel" },
  { code: "7412501", name: "E-Team Meetings" },
  { code: "7413100", name: "President Business Meals" },
  { code: "7413200", name: "EVP Business Meals" },
  { code: "7413300", name: "CFO Business Meals" },
  { code: "7414100", name: "President Misc" },
  { code: "7414200", name: "EVP Misc" },
  { code: "7414300", name: "CFO Misc" },
  { code: "7422000", name: "Board Expenses - JV USA" },
  { code: "7425000", name: "Staff Years of Service Expense" },];

// 8-series — every other account (field ministry).
const STANDARD = [
  { code: "8147000", name: "Business Meals" },
  { code: "8210000", name: "Exchange Fees / Bank Charges" },
  { code: "8220000", name: "Credit Card Fees" },
  { code: "8241000", name: "Medical Premiums" },
  { code: "8243000", name: "Children's Education" },
  { code: "8244000", name: "Language Education" },
  { code: "8331000", name: "Office - General" },
  { code: "8332000", name: "Office - Equipment" },
  { code: "8333000", name: "Office - Supplies" },
  { code: "8334000", name: "Printing & Publication" },
  { code: "8335100", name: "Computer Equipment" },
  { code: "8335200", name: "Computer Programs" },
  { code: "8335300", name: "Computer Support / Repairs" },
  { code: "8336000", name: "Film & Development" },
  { code: "8337000", name: "Books/Literature/Subscription" },
  { code: "8338000", name: "Camp Supplies" },
  { code: "8341000", name: "Telephone Home" },
  { code: "8342000", name: "Telephone Cell" },
  { code: "8343000", name: "Telephone Internet" },
  { code: "8344000", name: "Telephone Other" },
  { code: "8350000", name: "Postage & Shipping" },
  { code: "8370000", name: "Equipment" },
  { code: "8391000", name: "Travel Airfare" },
  { code: "8392000", name: "Travel Automobile" },
  { code: "8393000", name: "Travel Hotel" },
  { code: "8394000", name: "Travel Meals" },
  { code: "8395000", name: "Travel Public Transportation" },
  { code: "8396000", name: "Travel Other" },
  { code: "8397000", name: "Travel Visa" },
  { code: "8398000", name: "Travel Train" },
  { code: "8399000", name: "Travel rental vehicle" },
  { code: "8400000", name: "Conferences" },
  { code: "8410000", name: "JV Women's Retreat" },
  { code: "8410610", name: "Concentric Travel" },
  { code: "8410611", name: "Concentric Summit Travel" },
  { code: "8410650", name: "Other Concentric Expenses" },
  { code: "8410660", name: "Concentric Contractor Payments" },
  { code: "8430000", name: "Miscellaneous" },
  { code: "8440000", name: "Summer Interns" },
  { code: "8450000", name: "Supporter Gifts" },
  { code: "8460000", name: "Hospitality" },
  { code: "8470000", name: "Startup Costs" },
  { code: "8480000", name: "Communications" },
  { code: "8490000", name: "Camps General" },
  { code: "8500000", name: "Believers Aid" },
  { code: "8510000", name: "Ministry Supplies" },
  { code: "8520000", name: "Prayer Letter" },
  { code: "8530000", name: "Relief Aid" },
  { code: "8540000", name: "Training" },
  { code: "8542000", name: "Tuition" },
  { code: "8580000", name: "Office Furnishings/Equipment" },];

const CATEGORY_SETS = { general: GENERAL, standard: STANDARD };

// Which set an account uses. General Fund → 7-series; everything else → 8-series.
function categorySetKey(accountCode) {
  return String(accountCode || '').trim() === GENERAL_FUND_ACCOUNT_CODE ? 'general' : 'standard';
}

function categoriesForAccount(accountCode) {
  return CATEGORY_SETS[categorySetKey(accountCode)] || [];
}

// Is this GL code one of the codes valid for that account's set?
function isValidCategoryCode(accountCode, code) {
  const c = String(code || '').trim();
  return categoriesForAccount(accountCode).some((x) => x.code === c);
}

// The human name for a GL code (searches both sets). '' if unknown.
function categoryName(code) {
  const c = String(code || '').trim();
  for (const key of Object.keys(CATEGORY_SETS)) {
    const hit = CATEGORY_SETS[key].find((x) => x.code === c);
    if (hit) return hit.name;
  }
  return '';
}

module.exports = {
  GENERAL_FUND_ACCOUNT_CODE,
  CATEGORY_SETS,
  categorySetKey,
  categoriesForAccount,
  isValidCategoryCode,
  categoryName,
};
