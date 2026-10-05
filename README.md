# myenfia

A free ENFIA calculator for apartments in Greece: pin the property on a map, enter a few details, and get an estimate of the yearly property tax with every step of the calculation shown.

**Live:** https://nikvemmos.github.io/myenfia/

## Why I built this

ENFIA is the one tax every property owner in Greece pays every year, yet very few people can explain their own bill. The official notice gives you a number, not the reasoning behind it.

I wanted a quick, credible first estimate for two kinds of people: buyers screening a property, and agents preparing a listing. When you are comparing apartments, the annual holding cost matters just as much as the asking price, and ENFIA is part of that cost.

The existing calculators I tried all ask for the *zone price* (τιμή ζώνης), the official value per m² behind the tax. Almost nobody knows that number for their own address. So the starting point for this project was simple: find the zone price for the user from the map, and keep everything else to inputs an owner actually knows.

## How I approached it

**One common case, done properly.** I deliberately limited the scope to an apartment owned by an individual. That covers most owners, and it keeps the tool honest: no business property, land or detached houses.

**Accuracy target of ±10%.** A 100% exact figure is impossible from the information an owner has (income-based discounts, for example, depend on the tax return). So I aimed for a figure close enough to make decisions with, and wrote down every simplification.

**The biggest source of error is the input, not the formula.** Once the zone price is right, the rest is deterministic. The site loads AADE's official zones (about 13,000 area zones and 5,000 street zones across Greece) and looks up the price for the point you click.

**Rules from the law itself, then checked.** The rules come from the law, not from blog summaries (several of those turned out to be outdated):

- Main tax: Law 4223/2013, article 4, now part of the Property Tax Code (Law 5219/2025), with the rate table introduced by Law 4916/2022.
- Taxable value: Law 3842/2010, article 32.
- 2026 discounts: Law 5246/2025.

I then checked the calculation against the Ministry of Finance's official example table. Every comparable case matched to the cent.

## How the tax works, in short

1. **Main tax.** Area (m²) × a base rate per m² set by the zone price (€2.00 to €16.20). That is then multiplied by factors for the building's age, the floor and the street frontage. Storage rooms and parking spaces are taxed at 10%.
2. **Total property value.** The owner's total property value then adjusts the tax:
   - up to €400k, the tax is reduced by 10% to 30%;
   - above €500k, it is increased by 5% to 20%;
   - an apartment worth more than €400k pays an extra 0.2% to 1% on the amount above €400k.
3. **2026 discounts.** 20% off for a home insured against earthquake, fire and flood. 50% off for a main residence in a village of up to 1,500 inhabitants (outside Attica).

## What I found interesting

- **Threshold "cliffs".** The value-based reduction works in brackets, not on a sliding scale. An owner whose total property is worth €100,000 gets 30% off; at €100,001 it drops to 25% off the *whole* tax. The same happens at every threshold. As a finance student I find this a nice example of how bracketed relief creates sharp marginal effects.
- **The tax follows official values, not the market.** The tax is driven by the zone price, which is revised only every few years, not by what the apartment would actually sell for. Two apartments with the same market value can pay very different ENFIA, depending on how the state values their area.
- **Public data has gaps.** The latest official map layer quietly leaves out a few zones. One of them is the whole of Ilisia in central Athens. I found this by testing points across the city, and fixed it by filling the gaps from the previous layer.

## Limitations

- Income-based discounts, large-family and disability exemptions are not included.
- For points outside any zone, the price follows the legal rule (the lowest zone price of the municipal unit), but the taxable value is approximated.
- The tax rules are for 2026 and need updating each year.
- It is an estimate for information only, not tax advice. The official amount is the one on the AADE notice.

## Built with

Plain HTML, CSS and JavaScript, hosted on GitHub Pages. Map tiles are from OpenStreetMap, address search from Esri's World Geocoding Service. Zone prices are from AADE's public valuation map.
