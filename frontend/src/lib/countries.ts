/**
 * The ISO 3166-1 country list, and the two things the console does with it.
 *
 * Moved out of pages/fw-addresses/address-form.tsx, where it started life as the datasource for the
 * Geography address type's picker. The Local Traffic log needs the same table for the opposite
 * lookup — FortiOS logs a country by its ENGLISH NAME ("United States"), not its code, and the flag
 * beside an address in the log view has to come from somewhere — so it is data two pages share and
 * belongs somewhere whose name says what it is. address-form re-exports it, so nothing that already
 * imported it from there had to change.
 */

// ─── ISO 3166-1 country list ─────────────────────────────────────────────────
export const COUNTRIES: { code: string; name: string }[] = [
  { code:"AF",name:"Afghanistan" },{ code:"AX",name:"Åland Islands" },{ code:"AL",name:"Albania" },
  { code:"DZ",name:"Algeria" },{ code:"AS",name:"American Samoa" },{ code:"AD",name:"Andorra" },
  { code:"AO",name:"Angola" },{ code:"AI",name:"Anguilla" },{ code:"AQ",name:"Antarctica" },
  { code:"AG",name:"Antigua and Barbuda" },{ code:"AR",name:"Argentina" },{ code:"AM",name:"Armenia" },
  { code:"AW",name:"Aruba" },{ code:"AU",name:"Australia" },{ code:"AT",name:"Austria" },
  { code:"AZ",name:"Azerbaijan" },{ code:"BS",name:"Bahamas" },{ code:"BH",name:"Bahrain" },
  { code:"BD",name:"Bangladesh" },{ code:"BB",name:"Barbados" },{ code:"BY",name:"Belarus" },
  { code:"BE",name:"Belgium" },{ code:"BZ",name:"Belize" },{ code:"BJ",name:"Benin" },
  { code:"BM",name:"Bermuda" },{ code:"BT",name:"Bhutan" },{ code:"BO",name:"Bolivia" },
  { code:"BA",name:"Bosnia and Herzegovina" },{ code:"BW",name:"Botswana" },{ code:"BR",name:"Brazil" },
  { code:"BN",name:"Brunei Darussalam" },{ code:"BG",name:"Bulgaria" },{ code:"BF",name:"Burkina Faso" },
  { code:"BI",name:"Burundi" },{ code:"CV",name:"Cabo Verde" },{ code:"KH",name:"Cambodia" },
  { code:"CM",name:"Cameroon" },{ code:"CA",name:"Canada" },{ code:"KY",name:"Cayman Islands" },
  { code:"CF",name:"Central African Republic" },{ code:"TD",name:"Chad" },{ code:"CL",name:"Chile" },
  { code:"CN",name:"China" },{ code:"CO",name:"Colombia" },{ code:"KM",name:"Comoros" },
  { code:"CG",name:"Congo" },{ code:"CD",name:"Congo, Democratic Republic" },{ code:"CK",name:"Cook Islands" },
  { code:"CR",name:"Costa Rica" },{ code:"CI",name:"Côte d'Ivoire" },{ code:"HR",name:"Croatia" },
  { code:"CU",name:"Cuba" },{ code:"CY",name:"Cyprus" },{ code:"CZ",name:"Czechia" },
  { code:"DK",name:"Denmark" },{ code:"DJ",name:"Djibouti" },{ code:"DM",name:"Dominica" },
  { code:"DO",name:"Dominican Republic" },{ code:"EC",name:"Ecuador" },{ code:"EG",name:"Egypt" },
  { code:"SV",name:"El Salvador" },{ code:"GQ",name:"Equatorial Guinea" },{ code:"ER",name:"Eritrea" },
  { code:"EE",name:"Estonia" },{ code:"SZ",name:"Eswatini" },{ code:"ET",name:"Ethiopia" },
  { code:"FK",name:"Falkland Islands" },{ code:"FO",name:"Faroe Islands" },{ code:"FJ",name:"Fiji" },
  { code:"FI",name:"Finland" },{ code:"FR",name:"France" },{ code:"GF",name:"French Guiana" },
  { code:"PF",name:"French Polynesia" },{ code:"GA",name:"Gabon" },{ code:"GM",name:"Gambia" },
  { code:"GE",name:"Georgia" },{ code:"DE",name:"Germany" },{ code:"GH",name:"Ghana" },
  { code:"GI",name:"Gibraltar" },{ code:"GR",name:"Greece" },{ code:"GL",name:"Greenland" },
  { code:"GD",name:"Grenada" },{ code:"GP",name:"Guadeloupe" },{ code:"GU",name:"Guam" },
  { code:"GT",name:"Guatemala" },{ code:"GN",name:"Guinea" },{ code:"GW",name:"Guinea-Bissau" },
  { code:"GY",name:"Guyana" },{ code:"HT",name:"Haiti" },{ code:"VA",name:"Holy See" },
  { code:"HN",name:"Honduras" },{ code:"HK",name:"Hong Kong" },{ code:"HU",name:"Hungary" },
  { code:"IS",name:"Iceland" },{ code:"IN",name:"India" },{ code:"ID",name:"Indonesia" },
  { code:"IR",name:"Iran" },{ code:"IQ",name:"Iraq" },{ code:"IE",name:"Ireland" },
  { code:"IL",name:"Israel" },{ code:"IT",name:"Italy" },{ code:"JM",name:"Jamaica" },
  { code:"JP",name:"Japan" },{ code:"JO",name:"Jordan" },{ code:"KZ",name:"Kazakhstan" },
  { code:"KE",name:"Kenya" },{ code:"KI",name:"Kiribati" },{ code:"KP",name:"Korea, North" },
  { code:"KR",name:"Korea, South" },{ code:"KW",name:"Kuwait" },{ code:"KG",name:"Kyrgyzstan" },
  { code:"LA",name:"Laos" },{ code:"LV",name:"Latvia" },{ code:"LB",name:"Lebanon" },
  { code:"LS",name:"Lesotho" },{ code:"LR",name:"Liberia" },{ code:"LY",name:"Libya" },
  { code:"LI",name:"Liechtenstein" },{ code:"LT",name:"Lithuania" },{ code:"LU",name:"Luxembourg" },
  { code:"MO",name:"Macao" },{ code:"MG",name:"Madagascar" },{ code:"MW",name:"Malawi" },
  { code:"MY",name:"Malaysia" },{ code:"MV",name:"Maldives" },{ code:"ML",name:"Mali" },
  { code:"MT",name:"Malta" },{ code:"MH",name:"Marshall Islands" },{ code:"MQ",name:"Martinique" },
  { code:"MR",name:"Mauritania" },{ code:"MU",name:"Mauritius" },{ code:"MX",name:"Mexico" },
  { code:"FM",name:"Micronesia" },{ code:"MD",name:"Moldova" },{ code:"MC",name:"Monaco" },
  { code:"MN",name:"Mongolia" },{ code:"ME",name:"Montenegro" },{ code:"MS",name:"Montserrat" },
  { code:"MA",name:"Morocco" },{ code:"MZ",name:"Mozambique" },{ code:"MM",name:"Myanmar" },
  { code:"NA",name:"Namibia" },{ code:"NR",name:"Nauru" },{ code:"NP",name:"Nepal" },
  { code:"NL",name:"Netherlands" },{ code:"NC",name:"New Caledonia" },{ code:"NZ",name:"New Zealand" },
  { code:"NI",name:"Nicaragua" },{ code:"NE",name:"Niger" },{ code:"NG",name:"Nigeria" },
  { code:"NU",name:"Niue" },{ code:"MK",name:"North Macedonia" },{ code:"NO",name:"Norway" },
  { code:"OM",name:"Oman" },{ code:"PK",name:"Pakistan" },{ code:"PW",name:"Palau" },
  { code:"PS",name:"Palestine" },{ code:"PA",name:"Panama" },{ code:"PG",name:"Papua New Guinea" },
  { code:"PY",name:"Paraguay" },{ code:"PE",name:"Peru" },{ code:"PH",name:"Philippines" },
  { code:"PL",name:"Poland" },{ code:"PT",name:"Portugal" },{ code:"PR",name:"Puerto Rico" },
  { code:"QA",name:"Qatar" },{ code:"RE",name:"Réunion" },{ code:"RO",name:"Romania" },
  { code:"RU",name:"Russia" },{ code:"RW",name:"Rwanda" },{ code:"KN",name:"Saint Kitts and Nevis" },
  { code:"LC",name:"Saint Lucia" },{ code:"VC",name:"Saint Vincent and the Grenadines" },
  { code:"WS",name:"Samoa" },{ code:"SM",name:"San Marino" },{ code:"ST",name:"Sao Tome and Principe" },
  { code:"SA",name:"Saudi Arabia" },{ code:"SN",name:"Senegal" },{ code:"RS",name:"Serbia" },
  { code:"SC",name:"Seychelles" },{ code:"SL",name:"Sierra Leone" },{ code:"SG",name:"Singapore" },
  { code:"SK",name:"Slovakia" },{ code:"SI",name:"Slovenia" },{ code:"SB",name:"Solomon Islands" },
  { code:"SO",name:"Somalia" },{ code:"ZA",name:"South Africa" },{ code:"SS",name:"South Sudan" },
  { code:"ES",name:"Spain" },{ code:"LK",name:"Sri Lanka" },{ code:"SD",name:"Sudan" },
  { code:"SR",name:"Suriname" },{ code:"SE",name:"Sweden" },{ code:"CH",name:"Switzerland" },
  { code:"SY",name:"Syria" },{ code:"TW",name:"Taiwan" },{ code:"TJ",name:"Tajikistan" },
  { code:"TZ",name:"Tanzania" },{ code:"TH",name:"Thailand" },{ code:"TL",name:"Timor-Leste" },
  { code:"TG",name:"Togo" },{ code:"TO",name:"Tonga" },{ code:"TT",name:"Trinidad and Tobago" },
  { code:"TN",name:"Tunisia" },{ code:"TR",name:"Turkey" },{ code:"TM",name:"Turkmenistan" },
  { code:"TV",name:"Tuvalu" },{ code:"UG",name:"Uganda" },{ code:"UA",name:"Ukraine" },
  { code:"AE",name:"United Arab Emirates" },{ code:"GB",name:"United Kingdom" },
  { code:"US",name:"United States" },{ code:"UY",name:"Uruguay" },{ code:"UZ",name:"Uzbekistan" },
  { code:"VU",name:"Vanuatu" },{ code:"VE",name:"Venezuela" },{ code:"VN",name:"Vietnam" },
  { code:"YE",name:"Yemen" },{ code:"ZM",name:"Zambia" },{ code:"ZW",name:"Zimbabwe" },
];

export const COUNTRY_NAMES: Record<string, string> =
  Object.fromEntries(COUNTRIES.map((c) => [c.code, c.name]));

// Flag emoji from ISO 2-letter code.
export function flagEmoji(code: string): string {
  return code.toUpperCase().replace(/./g, (c) =>
    String.fromCodePoint(c.charCodeAt(0) + 0x1F1A5)
  );
}

/**
 * ISO code for a country's English name, or "" for anything not on the list.
 *
 * Built once and lower-cased on both sides, because the names arriving here come from a FortiGate
 * log rather than from our own picker and their casing is the device's business, not ours.
 *
 * FortiOS also emits pseudo-countries — "Reserved" for an RFC1918 address it declines to
 * geolocate — which are simply absent from the table and so return "". That is the right answer:
 * they are not places and must not get a flag.
 */
const BY_NAME: Record<string, string> = Object.fromEntries(
  COUNTRIES.map((c) => [c.name.toLowerCase(), c.code]),
);

export function countryCode(name: string): string {
  return BY_NAME[name.trim().toLowerCase()] ?? "";
}
